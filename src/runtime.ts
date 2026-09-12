/** Agent-local selected sets and model-visible tool filtering. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import {
  defineTool,
  renderToolsSdk,
  renderToolsSdkPy,
  RUN_CODE_NAME,
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
  TOOL_SDK_LANGUAGE_MARKERS,
  TOOL_SDK_SECTION_NAME,
  type CatalogSnapshot,
  type ToolSearchSettings,
} from './shared.ts'

const RESULT_SCHEMA_VERSION = 1
const MAX_QUERY_LENGTH = 4096
const MAX_DESCRIPTION_LENGTH = 240

/** One entry of the generated PTC SDK contract, as `renderToolsSdk` expects it. */
type SdkSchema = Parameters<typeof renderToolsSdk>[0][number]

/** The subset of a registered tool definition the SDK projection consumes. */
interface ToolDefinitionLike {
  description?: string
  parameters?: unknown
  output?: { schema?: unknown }
}

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

  /**
   * The searchable registry view for one Agent: every tool it could reach,
   * whether or not the current presentation shows it.
   *
   * The reserved PTC transport is excluded: it is never searchable, never
   * constrained by policy, and never part of the generated SDK it carries.
   * Reading the registry (rather than the assembled schemas) is what keeps the
   * corpus complete under PTC presentation, where the assembly itself carries
   * only `run_code`.
   */
  private refreshCatalog(state: AgentState): ToolCatalogEntry[] {
    if (state.catalogGeneration !== this.generation) {
      state.catalog = buildCatalog(
        (this.ctx.tools.schemas(state.agent) as ToolSchemaLike[])
          .filter(tool => tool.name !== RUN_CODE_NAME),
      )
      state.catalogGeneration = this.generation
    }
    return state.catalog
  }

  /**
   * Hide every deferred tool from one final assembly.
   *
   * Two surfaces carry tools and both must agree: the native schema list plus
   * its `tool:<name>` guidance sections, and — under `ptc`/`both` — the
   * generated `tools:sdk` section. The SDK text is regenerated with the same
   * renderer `dsh-tools` uses, from the surviving tools alone, so the filtered
   * assembly is byte-identical to the one the registry would have built for
   * that smaller tool set.
   */
  private filterAssembly(state: AgentState, assembly: PromptAssembly): PromptAssembly {
    const catalog = this.refreshCatalog(state)
    const known = new Set(catalog.map(tool => tool.name))
    const visible = new Set(
      catalog
        .map(tool => tool.name)
        .filter(name => this.policy.classify(name, state.selected) === 'always'),
    )
    const hidden = new Set(catalog.map(tool => tool.name).filter(name => !visible.has(name)))
    const tools = assembly.tools.filter(tool => !known.has(tool.name) || visible.has(tool.name))
    let sdkRewritten = false
    const sections = assembly.sections
      .filter(section => {
        const name = toolSectionName(section.name)
        return name === undefined || !hidden.has(name)
      })
      .map(section => {
        // An empty SDK section is an Agent-scoped opt-out of PTC presentation
        // (a native override under a PTC deployment): there is nothing to filter.
        if (section.name !== TOOL_SDK_SECTION_NAME || hidden.size === 0 || section.text.trim().length === 0) {
          return section
        }
        const text = this.renderSdk(state, visible, section.text)
        if (text === section.text) return section
        sdkRewritten = true
        return { ...section, text }
      })
    if (tools.length === assembly.tools.length && sections.length === assembly.sections.length && !sdkRewritten) {
      return assembly
    }
    return { ...assembly, tools, sections }
  }

  /**
   * Rebuild the PTC SDK section for the surviving tools.
   *
   * The flavor must be the one the session already programs against, so it
   * comes from the mounted code runtime; a host that cannot answer for it
   * falls back to the marker the existing section was rendered with.
   */
  private renderSdk(state: AgentState, visible: ReadonlySet<string>, original: string): string {
    const render = this.resolveSdkRenderer(original)
    const schemas: SdkSchema[] = []
    for (const tool of state.catalog) {
      if (!visible.has(tool.name)) continue
      const definition = this.toolDefinition(tool.name, state.agent)
      schemas.push({
        name: tool.name,
        description: definition?.description ?? tool.description,
        parameters: cloneJson(definition?.parameters ?? tool.parameters) as SdkSchema['parameters'],
        output: cloneJson(definition?.output?.schema ?? {}) as SdkSchema['output'],
      })
    }
    return render(schemas)
  }

  private resolveSdkRenderer(original: string): (schemas: SdkSchema[]) => string {
    const runtime = this.codeRuntime()
    if (runtime.language === 'typescript') return renderToolsSdk
    if (runtime.language === 'python') return renderToolsSdkPy
    if (original.includes(TOOL_SDK_LANGUAGE_MARKERS.python)) return renderToolsSdkPy
    if (original.includes(TOOL_SDK_LANGUAGE_MARKERS.typescript)) return renderToolsSdk
    throw new Error(
      `${TOOL_SEARCH_NAME}: cannot filter the generated tool SDK for code runtime language `
      + `${JSON.stringify(runtime.language ?? 'unknown')}`,
    )
  }

  private codeRuntime(): { language?: unknown } {
    const runtime = (this.ctx as unknown as { get?: (name: string) => unknown }).get?.('codeRuntime')
    return typeof runtime === 'object' && runtime !== null ? runtime as { language?: unknown } : {}
  }

  private toolDefinition(name: string, agent: Agent): ToolDefinitionLike | undefined {
    const registry = this.ctx.tools as unknown as { get?: (name: string, scope?: unknown) => unknown }
    if (typeof registry.get !== 'function') return undefined
    const definition = registry.get(name, agent)
    return typeof definition === 'object' && definition !== null ? definition as ToolDefinitionLike : undefined
  }
}

/** Lossless clone of a schema node; a value that cannot be cloned is used as-is. */
function cloneJson<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}
