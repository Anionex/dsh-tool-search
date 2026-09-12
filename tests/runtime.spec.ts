import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { renderToolsSdk } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import type { ToolSchemaLike } from '../src/catalog.ts'
import { ToolSearchRuntime, type ToolSearchResult } from '../src/runtime.ts'
import { TOOL_SEARCH_NAME, type ToolSearchSettings } from '../src/shared.ts'

type AssemblyListener = (
  assembly: PromptAssembly,
  context: object,
  next: () => Promise<PromptAssembly>,
) => Promise<PromptAssembly>

type RootListener = (...args: unknown[]) => unknown

function schema(name: string, description: string): ToolSchemaLike {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: { type: 'string', description: `${description} target.` },
      },
    },
  }
}

function makeAgent(id: string, events: unknown[] = [], sessionApi: 'events' | 'snapshot' = 'events') {
  let assemblyListener: AssemblyListener | undefined
  const agent = {
    id,
    session: sessionApi === 'snapshot' ? { snapshotEvents: () => events } : { events },
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

function harness(options: {
  agents?: ReturnType<typeof makeAgent>[]
  settings?: Partial<ToolSearchSettings>
  schemas?: ToolSchemaLike[]
} = {}) {
  const agents = options.agents ?? [makeAgent('agent-1')]
  let schemas = options.schemas ?? [
    schema('apply_patch', 'Edit files with a patch'),
    schema(TOOL_SEARCH_NAME, 'Search deferred tools'),
    schema('browser_take_screenshot', 'Capture a browser screenshot'),
    schema('web_search', 'Search current public web sources'),
    schema('read_image', 'Inspect a local image'),
  ]
  const listeners = new Map<string, RootListener[]>()
  const ctx = {
    agents: { list: () => agents.map(item => item.agent) },
    tools: { schemas: () => schemas },
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
  const assembly = (): PromptAssembly => ({
    sections: schemas.map(tool => ({ name: `tool:${tool.name}`, text: `${tool.name} guidance` })),
    contexts: [],
    tools: schemas as never,
    variables: {},
  })
  return {
    agents,
    runtime,
    dispose,
    setSchemas(next: ToolSchemaLike[]) { schemas = next },
    emit(name: string, ...args: unknown[]) {
      for (const listener of listeners.get(name) ?? []) listener(...args)
    },
    assembly,
    async search(agent: Agent, query: string, limit?: number): Promise<ToolSearchResult> {
      const exec = {
        agent,
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
      this.emit('tools/result', exec, {
        isError: false,
        value,
        content: [{ type: 'text', text: JSON.stringify(value) }],
      })
      return value
    },
  }
}

function recoveryEvents(selected: string[]): unknown[] {
  return [{
    type: 'tool/call',
    data: { callId: 'search-1', name: TOOL_SEARCH_NAME, arguments: '{"query":"image"}' },
  }, {
    type: 'tool/result',
    data: {
      message: {
        content: [{
          type: 'tool-result',
          toolCallId: 'search-1',
          isError: false,
          content: [{
            type: 'text',
            text: JSON.stringify({
              schemaVersion: 1,
              query: 'image',
              tools: selected.map(name => ({ name, description: '', score: 1 })),
            }),
          }],
        }],
      },
    },
  }]
}

describe('ToolSearchRuntime', () => {
  it('reveals deferred schemas on the next assembly and never returns full schemas', async () => {
    const app = harness()
    const initial = await app.agents[0]!.assemble(app.assembly())
    expect(initial.tools.map(tool => tool.name)).toEqual(['apply_patch', TOOL_SEARCH_NAME])
    expect(initial.sections.map(section => section.name)).toEqual(['tool:apply_patch', `tool:${TOOL_SEARCH_NAME}`])

    let modelCalls = 1
    const result = await app.search(app.agents[0]!.agent, 'browser_take_screenshot', 1)
    expect(JSON.stringify(result)).not.toMatch(/parameters|properties|schema\s*:/u)
    expect(result.tools.map(tool => tool.name)).toEqual(['browser_take_screenshot'])

    modelCalls += 1
    const next = await app.agents[0]!.assemble(app.assembly())
    expect(next.tools.map(tool => tool.name)).toEqual(['apply_patch', TOOL_SEARCH_NAME, 'browser_take_screenshot'])
    expect(modelCalls).toBe(2)
    app.dispose()
  })

  it('keeps selected sets isolated per agent and monotonically growing', async () => {
    const first = makeAgent('first')
    const second = makeAgent('second')
    const app = harness({ agents: [first, second] })
    await app.search(first.agent, 'browser_take_screenshot', 1)
    await app.search(first.agent, 'web_search', 1)
    expect([...app.runtime.selectedFor(first.agent)].sort()).toEqual(['browser_take_screenshot', 'web_search'])
    expect([...app.runtime.selectedFor(second.agent)]).toEqual([])
    expect((await first.assemble(app.assembly())).tools.map(tool => tool.name)).toContain('web_search')
    expect((await second.assemble(app.assembly())).tools.map(tool => tool.name)).not.toContain('web_search')
    app.dispose()
  })

  it('recovers selected sets independently from resume and fork history prefixes', async () => {
    const resume = makeAgent('resume', recoveryEvents(['read_image', 'web_search']), 'snapshot')
    const fork = makeAgent('fork', recoveryEvents(['read_image']))
    const app = harness({ agents: [resume, fork] })
    expect([...app.runtime.selectedFor(resume.agent)].sort()).toEqual(['read_image', 'web_search'])
    expect([...app.runtime.selectedFor(fork.agent)]).toEqual(['read_image'])
    expect((await resume.assemble(app.assembly())).tools.map(tool => tool.name)).toContain('web_search')
    expect((await fork.assemble(app.assembly())).tools.map(tool => tool.name)).not.toContain('web_search')
    app.dispose()
  })

  it('invalidates every agent catalog when registry metadata changes', async () => {
    const app = harness()
    await app.agents[0]!.assemble(app.assembly())
    app.setSchemas([
      ...app.assembly().tools as never,
      schema('browser_pdf_export', 'Export the browser page as a PDF document'),
    ])
    app.emit('tools/change')
    const result = await app.search(app.agents[0]!.agent, 'browser_pdf_export', 1)
    expect(result.tools[0]?.name).toBe('browser_pdf_export')
    app.dispose()
  })

  it('applies live policies without deleting selected history', async () => {
    const app = harness()
    await app.search(app.agents[0]!.agent, 'web_search', 1)
    app.runtime.updateSettings({
      defaultLimit: 5,
      alwaysVisible: ['read_image'],
      neverSearch: ['web_search'],
    })
    const blocked = await app.agents[0]!.assemble(app.assembly())
    expect(blocked.tools.map(tool => tool.name)).toContain('read_image')
    expect(blocked.tools.map(tool => tool.name)).not.toContain('web_search')
    expect(app.runtime.selectedFor(app.agents[0]!.agent).has('web_search')).toBe(true)
    app.runtime.updateSettings({ defaultLimit: 5, alwaysVisible: [], neverSearch: [] })
    expect((await app.agents[0]!.assemble(app.assembly())).tools.map(tool => tool.name)).toContain('web_search')
    app.dispose()
  })

  it('commits selections only from final successful tool results', async () => {
    const app = harness()
    const agent = app.agents[0]!.agent
    const exec = {
      agent,
      name: TOOL_SEARCH_NAME,
      callId: 'pending-search',
      rootCallId: 'pending-search',
      token: Symbol('pending-search'),
      arguments: { query: 'web_search' },
      signal: new AbortController().signal,
    }
    const value = await app.runtime.definition.execute({ query: 'web_search', limit: 1 }, exec as never) as ToolSearchResult
    expect([...app.runtime.selectedFor(agent)]).toEqual([])

    app.emit('tools/result', exec, {
      isError: true,
      error: { message: 'blocked after execution' },
      content: [{ type: 'text', text: 'blocked' }],
    })
    expect([...app.runtime.selectedFor(agent)]).toEqual([])

    app.emit('tools/result', exec, {
      isError: false,
      value,
      content: [{ type: 'text', text: 'post-execute replacement' }],
    })
    expect([...app.runtime.selectedFor(agent)]).toEqual(['web_search'])
    app.dispose()
  })

  it('filters the generated SDK section instead of rejecting PTC and both assemblies', async () => {
    const app = harness()
    const assembly = app.assembly()
    assembly.sections.push({
      name: 'tools:sdk',
      text: renderToolsSdk(assembly.tools.map(tool => ({
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.parameters,
        output: {},
      }))),
    })
    const filtered = await app.agents[0]!.assemble(assembly)
    expect(filtered.tools.map(tool => tool.name)).toEqual(['apply_patch', TOOL_SEARCH_NAME])
    const sdk = filtered.sections.find(section => section.name === 'tools:sdk')?.text ?? ''
    expect(sdk).toContain('apply_patch')
    expect(sdk).toContain(TOOL_SEARCH_NAME)
    expect(sdk).not.toContain('web_search')
    expect(sdk).not.toContain('browser_take_screenshot')
    app.dispose()
  })

  it('accepts an empty SDK section from an Agent-scoped native override', async () => {
    const app = harness()
    const assembly = app.assembly()
    assembly.sections.push({ name: 'tools:sdk', text: '' })
    await expect(app.agents[0]!.assemble(assembly)).resolves.toMatchObject({
      tools: [{ name: 'apply_patch' }, { name: TOOL_SEARCH_NAME }],
    })
    app.dispose()
  })
})
