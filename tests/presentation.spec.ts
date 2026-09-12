import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { renderToolsSdk, renderToolsSdkPy, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { ToolSearchRuntime, type ToolSearchResult } from '../src/runtime.ts'
import { TOOL_SEARCH_NAME, type ToolSearchSettings } from '../src/shared.ts'

type AssemblyListener = (
  assembly: PromptAssembly,
  context: object,
  next: () => Promise<PromptAssembly>,
) => Promise<PromptAssembly>

type RootListener = (...args: unknown[]) => unknown

interface FixtureTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: Record<string, unknown>
}

function fixtureTool(name: string, description: string): FixtureTool {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: { type: 'string', description: `${description} target.` },
      },
      required: ['target'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean', required: true } },
    },
  }
}

const DEFAULT_TOOLS: FixtureTool[] = [
  fixtureTool('apply_patch', 'Edit files with a patch'),
  fixtureTool(TOOL_SEARCH_NAME, 'Search deferred tools'),
  fixtureTool('browser_take_screenshot', 'Capture a browser screenshot'),
  fixtureTool('web_search', 'Search current public web sources'),
]

/** The `tools:sdk` body a real registry renders for one tool set. */
function sdkText(tools: readonly FixtureTool[], render = renderToolsSdk): string {
  return render(tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    output: tool.output,
  })))
}

function makeAgent(id: string) {
  let assemblyListener: AssemblyListener | undefined
  const agent = {
    id,
    session: { events: [] },
    ctx: {
      on(name: string, listener: AssemblyListener) {
        if (name === 'system-prompt/assemble') assemblyListener = listener
        return () => {
          if (assemblyListener === listener) assemblyListener = undefined
        }
      },
    },
  } as unknown as Agent
  return {
    agent,
    assemble(assembly: PromptAssembly): Promise<PromptAssembly> {
      if (assemblyListener === undefined) throw new Error('assembly listener was not installed')
      return assemblyListener(assembly, {}, () => Promise.resolve(assembly))
    },
  }
}

/**
 * Harness for one presentation mode. The registry view carries every tool plus
 * the reserved transport; each mode then builds the assembly the real registry
 * would build: `ptc` collapses the schema list to `run_code` and adds the
 * generated SDK, `both` keeps both surfaces.
 */
function harness(options: {
  mode: 'native' | 'ptc' | 'both'
  language?: string
  settings?: Partial<ToolSearchSettings>
  tools?: FixtureTool[]
  withCodeRuntime?: boolean
} ) {
  const tools = options.tools ?? DEFAULT_TOOLS
  const agent = makeAgent('agent-1')
  const listeners = new Map<string, RootListener[]>()
  const ctx = {
    agents: { list: () => [agent.agent] },
    tools: {
      // The registry view: every tool the Agent could reach. The reserved
      // transport joins it only where PTC presentation is actually selected.
      schemas: () => options.mode === 'native'
        ? [...tools]
        : [...tools, { name: RUN_CODE_NAME, description: 'Run a program', parameters: {} }],
      // Registered definitions carry the output contract as `{ schema, render }`.
      get: (name: string) => {
        const tool = tools.find(candidate => candidate.name === name)
        if (tool === undefined) return undefined
        return { ...tool, output: { schema: tool.output, render: () => [] } }
      },
    },
    get: (name: string) =>
      name === 'codeRuntime' && options.withCodeRuntime !== false
        ? { language: options.language ?? 'typescript' }
        : undefined,
    logger: { warn: vi.fn() },
    on(name: string, listener: RootListener) {
      const rows = listeners.get(name) ?? []
      rows.push(listener)
      listeners.set(name, rows)
      return () => listeners.set(name, rows.filter(row => row !== listener))
    },
  }
  const runtime = new ToolSearchRuntime(ctx as never, {
    defaultLimit: 5,
    alwaysVisible: [],
    neverSearch: [],
    ...options.settings,
  })
  const dispose = runtime.install()
  const render = options.language === 'python' ? renderToolsSdkPy : renderToolsSdk
  const assembly = (): PromptAssembly => {
    const sections = tools.map(tool => ({ name: `tool:${tool.name}`, text: `${tool.name} guidance` }))
    if (options.mode !== 'native') {
      sections.unshift({ name: 'tools:ptc-only', text: `\`${RUN_CODE_NAME}\` is the only tool you can call directly.` })
      sections.push({ name: 'tools:sdk', text: sdkText(tools, render) })
    }
    return {
      sections,
      contexts: [],
      tools: (options.mode === 'native'
        ? [...tools]
        : options.mode === 'ptc'
          ? [{ name: RUN_CODE_NAME, description: 'Run a program', parameters: {} }]
          : [...tools, { name: RUN_CODE_NAME, description: 'Run a program', parameters: {} }]) as never,
      variables: {},
    }
  }
  return {
    agent: agent.agent,
    runtime,
    dispose,
    assemble: () => agent.assemble(assembly()),
    assembleRaw: (value: PromptAssembly) => agent.assemble(value),
    raw: assembly,
    async search(query: string, limit?: number): Promise<ToolSearchResult> {
      const exec = {
        agent: agent.agent,
        name: TOOL_SEARCH_NAME,
        callId: 'call-search',
        rootCallId: 'call-search',
        token: Symbol('test-token'),
        arguments: { query },
        signal: new AbortController().signal,
      }
      const value = await runtime.definition.execute(
        { query, ...(limit === undefined ? {} : { limit }) },
        exec as never,
      ) as ToolSearchResult
      for (const listener of listeners.get('tools/result') ?? []) {
        listener(exec, { isError: false, value, content: [{ type: 'text', text: JSON.stringify(value) }] })
      }
      return value
    },
  }
}

function sdkSection(assembly: PromptAssembly): string {
  const section = assembly.sections.find(candidate => candidate.name === 'tools:sdk')
  if (section === undefined) throw new Error('assembly carries no tools:sdk section')
  return section.text
}

describe('PTC presentation support', () => {
  it('filters the generated SDK and keeps the transport in ptc mode', async () => {
    const app = harness({ mode: 'ptc' })
    const assembly = await app.assemble()

    expect(assembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    expect(sdkSection(assembly)).toBe(sdkText([
      DEFAULT_TOOLS[0]!,
      DEFAULT_TOOLS[1]!,
    ]))
    expect(sdkSection(assembly)).not.toContain('web_search')
    expect(sdkSection(assembly)).not.toContain('browser_take_screenshot')
    expect(sdkSection(assembly)).toContain('apply_patch')
    expect(sdkSection(assembly)).toContain(TOOL_SEARCH_NAME)
    expect(assembly.sections.map(section => section.name)).toContain('tools:ptc-only')
    expect(assembly.sections.map(section => section.name)).not.toContain('tool:web_search')
    app.dispose()
  })

  it('adds tools to the SDK on the next assembly after a successful search', async () => {
    const app = harness({ mode: 'ptc' })
    const before = await app.assemble()
    expect(sdkSection(before)).not.toContain('web_search')

    const result = await app.search('web search public sources', 1)
    expect(result.tools.map(tool => tool.name)).toEqual(['web_search'])

    const after = await app.assemble()
    expect(sdkSection(after)).toContain('web_search')
    expect(sdkSection(after)).toBe(sdkText([
      DEFAULT_TOOLS[0]!,
      DEFAULT_TOOLS[1]!,
      DEFAULT_TOOLS[3]!,
    ]))
    expect(after.sections.map(section => section.name)).toContain('tool:web_search')
    app.dispose()
  })

  it('filters both surfaces under the both presentation', async () => {
    const app = harness({ mode: 'both' })
    const assembly = await app.assemble()

    expect(assembly.tools.map(tool => tool.name)).toEqual([
      'apply_patch',
      TOOL_SEARCH_NAME,
      RUN_CODE_NAME,
    ])
    expect(sdkSection(assembly)).toBe(sdkText([DEFAULT_TOOLS[0]!, DEFAULT_TOOLS[1]!]))
    app.dispose()
  })

  it('renders the SDK flavor the mounted code runtime selects', async () => {
    const app = harness({ mode: 'ptc', language: 'python' })
    const assembly = await app.assemble()

    expect(sdkSection(assembly)).toBe(sdkText([DEFAULT_TOOLS[0]!, DEFAULT_TOOLS[1]!], renderToolsSdkPy))
    expect(sdkSection(assembly)).toContain('class Tools(Protocol)')
    app.dispose()
  })

  it('reads the flavor from the section when the runtime is unreachable', async () => {
    const app = harness({ mode: 'ptc', withCodeRuntime: false })
    const assembly = await app.assemble()

    expect(sdkSection(assembly)).toBe(sdkText([DEFAULT_TOOLS[0]!, DEFAULT_TOOLS[1]!]))
    app.dispose()
  })

  it('leaves an Agent-scoped native override (empty SDK section) untouched', async () => {
    const app = harness({ mode: 'native' })
    const raw = app.raw()
    raw.sections.push({ name: 'tools:sdk', text: '' })
    const assembly = await app.assembleRaw(raw)
    expect(assembly.tools.map(tool => tool.name)).toEqual(['apply_patch', TOOL_SEARCH_NAME])
    app.dispose()
  })

  it('returns the identical assembly when no tool is hidden', async () => {
    const app = harness({
      mode: 'ptc',
      settings: { alwaysVisible: DEFAULT_TOOLS.map(tool => tool.name) },
    })
    const raw = app.raw()
    const assembly = await app.assembleRaw(raw)
    expect(assembly).toBe(raw)
    app.dispose()
  })
})
