/** Agent-local selected sets and model-visible tool filtering. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import {
  defineTool,
  type ToolDefinition,
  type ToolExecution,
  type ToolExecutionResult,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import { Bm25Index } from './bm25.ts'
import { buildCatalog, type ToolCatalogEntry, type ToolSchemaLike } from './catalog.ts'
import { ToolPolicyResolver, normalizeSettings } from './settings.ts'
import {
  MAX_RESULT_LIMIT,
  TOOL_SEARCH_NAME,
  type CatalogSnapshot,
  type ToolSearchSettings,
} from './shared.ts'

const RESULT_SCHEMA_VERSION = 1
const MAX_QUERY_LENGTH = 4096
const MAX_DESCRIPTION_LENGTH = 240

export interface ToolSearchMatch {
  name: string
  description: string
  score: number
}

export interface ToolSearchResult {
  schemaVersion: 1
  query: string
  tools: ToolSearchMatch[]
}

interface AgentState {
  agent: Agent
  selected: Set<string>
  catalog: ToolCatalogEntry[]
  catalogGeneration: number
  disposeAssembly: () => void
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function summarize(description: string): string {
  const normalized = description.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= MAX_DESCRIPTION_LENGTH) return normalized
  return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 3)}...`
}

function parseSelectionResult(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  if (record['schemaVersion'] !== RESULT_SCHEMA_VERSION || !Array.isArray(record['tools'])) return []
  const names: string[] = []
  for (const candidate of record['tools']) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue
    const name = (candidate as Record<string, unknown>)['name']
    if (typeof name === 'string' && name.length > 0) names.push(name)
  }
  return names
}

function sessionEvents(agent: Agent): readonly unknown[] {
  const session = agent.session as unknown as {
    events?: readonly unknown[]
    snapshotEvents?: () => readonly unknown[]
  }
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  return Array.isArray(session.events) ? session.events : []
}

function selectedFromSession(agent: Agent): Set<string> {
  const searchCalls = new Set<string>()
  const selected = new Set<string>()
  for (const rawEvent of sessionEvents(agent)) {
    if (typeof rawEvent !== 'object' || rawEvent === null || Array.isArray(rawEvent)) continue
    const event = rawEvent as { type?: unknown, data?: Record<string, unknown> }
    if (event.type === 'tool/call' && event.data?.['name'] === TOOL_SEARCH_NAME) {
      searchCalls.add(String(event.data['callId']))
      continue
    }
    if (event.type !== 'tool/result' || typeof event.data?.['message'] !== 'object' || event.data['message'] === null) continue
    const content = (event.data['message'] as { content?: unknown }).content
    const result = Array.isArray(content) ? content[0] : undefined
    if (typeof result !== 'object' || result === null || Array.isArray(result)) continue
    const resultRecord = result as Record<string, unknown>
    if (!searchCalls.has(String(resultRecord['toolCallId'])) || resultRecord['isError'] === true) continue
    const blocks = resultRecord['content']
    if (!Array.isArray(blocks)) continue
    const text = blocks
      .filter((block): block is { type: 'text', text: string } => (
        typeof block === 'object'
        && block !== null
        && !Array.isArray(block)
        && (block as Record<string, unknown>)['type'] === 'text'
        && typeof (block as Record<string, unknown>)['text'] === 'string'
      ))
      .map(block => block.text)
      .join('')
    try {
      for (const name of parseSelectionResult(JSON.parse(text))) selected.add(name)
    } catch {
      // Failed and legacy tool results are not successful selection transitions.
    }
  }
  return selected
}

function toolSectionName(sectionName: string): string | undefined {
  if (!sectionName.startsWith('tool:')) return undefined
  const name = sectionName.slice('tool:'.length)
  return name.length > 0 ? name : undefined
}

export class ToolSearchRuntime {
  readonly definition: ToolDefinition
  private readonly states = new Map<Agent, AgentState>()
  private readonly policy: ToolPolicyResolver
  private settings: ToolSearchSettings
  private generation = 0

  constructor(
    private readonly ctx: Context,
    settings: ToolSearchSettings,
  ) {
    this.settings = normalizeSettings(settings)
    this.policy = new ToolPolicyResolver(this.settings)
    this.definition = this.createDefinition()
  }

  install(): () => void {
    const disposers = [
      this.ctx.on('agent/created', ({ agent }) => { this.attach(agent) }),
      this.ctx.on('agent/disposed', ({ agent }) => { this.detach(agent) }),
      this.ctx.on('tools/result', (exec, result) => { this.commitSelection(exec, result) }),
      this.ctx.on('tools/change', () => { this.generation += 1 }),
      this.ctx.on('system-prompt/change', () => { this.generation += 1 }),
    ]
    for (const agent of this.ctx.agents.list()) this.attach(agent)
    return () => {
      for (const state of this.states.values()) state.disposeAssembly()
      this.states.clear()
      for (const dispose of disposers.reverse()) dispose()
    }
  }

  updateSettings(value: ToolSearchSettings): void {
    this.settings = normalizeSettings(value)
    this.policy.update(this.settings)
  }

  snapshot(): CatalogSnapshot {
    const tools = new Map<string, ToolCatalogEntry>()
    for (const entry of buildCatalog(this.ctx.tools.schemas() as ToolSchemaLike[])) tools.set(entry.name, entry)
    for (const state of this.states.values()) {
      this.refreshCatalog(state)
      for (const entry of state.catalog) tools.set(entry.name, entry)
    }
    return {
      schemaVersion: 1,
      generation: this.generation,
      tools: [...tools.values()].sort((left, right) => compareNames(left.name, right.name)).map(tool => ({
        name: tool.name,
        description: summarize(tool.description),
        policy: this.policy.classify(tool.name),
        selectedBy: [...this.states.values()]
          .filter(state => state.selected.has(tool.name))
          .map(state => String(state.agent.id))
          .sort(compareNames),
      })),
    }
  }

  selectedFor(agent: Agent): ReadonlySet<string> {
    return this.requireState(agent).selected
  }

  private createDefinition(): ToolDefinition {
    return defineTool({
      name: TOOL_SEARCH_NAME,
      description: 'Search deferred tool metadata with deterministic local BM25. Matching tools become available by their real names on the next model call. Results contain summaries, not full schemas.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'Search query for deferred tools.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of tools to return. Defaults to 5.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            schemaVersion: { type: 'integer', const: RESULT_SCHEMA_VERSION, required: true },
            query: { type: 'string', required: true },
            tools: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  description: { type: 'string', required: true },
                  score: { type: 'number', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: (args, exec) => Promise.resolve(this.search(args, exec)),
      finalizeContent: (_exec, result) => result.isError
        ? undefined
        : [{ type: 'text', text: JSON.stringify(result.value) }],
      presentCall: args => ({
        card: 'generic',
        title: 'Search deferred tools',
        kind: 'read',
        rawInput: typeof args === 'object' && args !== null && 'query' in args
          ? String((args as { query: unknown }).query)
          : undefined,
      }),
    })
  }

  private search(args: { query: string; limit?: number }, exec: ToolRunContext): ToolSearchResult {
    const agent = exec.agent
    if (agent === undefined) throw new Error(`${TOOL_SEARCH_NAME}: an Agent Session is required`)
    const query = args.query.trim()
    if (query.length === 0) throw new Error(`${TOOL_SEARCH_NAME}: query must not be empty`)
    if (query.length > MAX_QUERY_LENGTH) throw new Error(`${TOOL_SEARCH_NAME}: query exceeds ${MAX_QUERY_LENGTH} characters`)
    if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > MAX_RESULT_LIMIT)) {
      throw new Error(`${TOOL_SEARCH_NAME}: limit must be an integer between 1 and ${MAX_RESULT_LIMIT}`)
    }

    const state = this.requireState(agent)
    this.refreshCatalog(state)
    const deferred = state.catalog.filter(tool => this.policy.classify(tool.name, state.selected) === 'deferred')
    const index = new Bm25Index(deferred.map(tool => ({ id: tool, name: tool.name, text: tool.searchText })))
    const limit = args.limit ?? this.settings.defaultLimit
    const tools = index.search(query, limit).map(match => ({
      name: match.id.name,
      description: summarize(match.id.description),
      score: Number(match.score.toFixed(6)),
    }))
    return { schemaVersion: RESULT_SCHEMA_VERSION, query, tools }
  }

  private commitSelection(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    if (exec.name !== TOOL_SEARCH_NAME || exec.agent === undefined || result.isError) return
    const state = this.requireState(exec.agent)
    for (const name of parseSelectionResult(result.value)) state.selected.add(name)
  }

  private attach(agent: Agent): void {
    if (this.states.has(agent)) return
    const selected = selectedFromSession(agent)
    const state = {
      agent,
      selected,
      catalog: [],
      catalogGeneration: -1,
      disposeAssembly: () => {},
    }
    state.disposeAssembly = agent.ctx.on(
      'system-prompt/assemble',
      async (_assembly, _context, next) => this.filterAssembly(state, await next()),
      { prepend: true },
    )
    this.states.set(agent, state)
  }

  private detach(agent: Agent): void {
    const state = this.states.get(agent)
    if (state === undefined) return
    this.states.delete(agent)
  }

  private requireState(agent: Agent): AgentState {
    this.attach(agent)
    const state = this.states.get(agent)
    if (state === undefined) throw new Error(`${TOOL_SEARCH_NAME}: Agent state could not be initialized`)
    return state
  }

  private refreshCatalog(state: AgentState): void {
    if (state.catalogGeneration === this.generation) return
    state.catalog = buildCatalog(this.ctx.tools.schemas(state.agent) as ToolSchemaLike[])
    state.catalogGeneration = this.generation
  }

  private filterAssembly(state: AgentState, assembly: PromptAssembly): PromptAssembly {
    if (assembly.sections.some(section => section.name === 'tools:sdk' && section.text.trim().length > 0)) {
      throw new Error('dsh-tool-search requires native tool presentation; code/PTC and both modes are unsupported')
    }
    state.catalog = buildCatalog(assembly.tools as ToolSchemaLike[])
    state.catalogGeneration = this.generation
    const visible = new Set(
      assembly.tools
        .map(tool => tool.name)
        .filter(name => this.policy.classify(name, state.selected) === 'always'),
    )
    const hidden = new Set(assembly.tools.map(tool => tool.name).filter(name => !visible.has(name)))
    return {
      ...assembly,
      tools: assembly.tools.filter(tool => visible.has(tool.name)),
      sections: assembly.sections.filter(section => {
        const name = toolSectionName(section.name)
        return name === undefined || !hidden.has(name)
      }),
    }
  }
}
