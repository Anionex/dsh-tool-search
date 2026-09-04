import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { ToolSearchRuntime } from '../src/runtime.ts'
import { TOOL_SEARCH_NAME } from '../src/shared.ts'

describe('real ToolRuntime execution regression', () => {
  it('preserves approval, guard, around, body, post, and result semantics for a deferred tool', async () => {
    const ctx = new Context()
    const promptFiber = ctx.plugin(SystemPrompt, {})
    await promptFiber.await()
    const toolFiber = ctx.plugin(ToolRuntime, { mode: 'native' })
    await toolFiber.await()

    const order: string[] = []
    const approval = vi.fn(() => {
      order.push('approval')
      return Promise.resolve('allowed-once' as const)
    })
    ctx.provide('approval', { request: approval } as never)
    ctx.provide('agents', { list: () => [] } as never)

    ctx.on('tools/pre-execute', async () => {
      order.push('pre')
      return { kind: 'ask', reason: 'regression approval' }
    })
    ctx.tools.guard(() => {
      order.push('guard')
      return undefined
    })
    ctx.on('tools/execute', async (_exec, next) => {
      order.push('around:before')
      const result = await next()
      order.push('around:after')
      return result
    })
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      order.push('post')
      return next()
    })
    ctx.on('tools/result', () => { order.push('result') })

    ctx.tools.register(defineTool({
      name: 'deferred_dangerous_operation',
      description: 'A deferred operation used by the pipeline regression test.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: () => {
        order.push('body')
        return Promise.resolve({ ok: true })
      },
    }))

    const assemblyListeners: Array<(...args: never[]) => unknown> = []
    const agent = {
      id: 'pipeline-agent',
      session: { events: [] },
      ctx: {
        on: (_name: string, listener: (...args: never[]) => unknown) => {
          assemblyListeners.push(listener)
          return () => {}
        },
      },
    } as unknown as Agent
    const search = new ToolSearchRuntime(ctx, {
      defaultLimit: 5,
      alwaysVisible: [],
      neverSearch: [],
    })
    const disposeSearch = search.install()
    search.selectedFor(agent)

    const result = await ctx.tools.execute({
      callId: 'pipeline-call' as never,
      name: 'deferred_dangerous_operation',
      arguments: {},
      agent,
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(approval).toHaveBeenCalledOnce()
    expect(order).toEqual([
      'pre',
      'approval',
      'guard',
      'around:before',
      'body',
      'around:after',
      'post',
      'result',
    ])
    expect(ctx.tools.get('deferred_dangerous_operation', agent)).toBeDefined()
    expect(assemblyListeners).toHaveLength(1)
    disposeSearch()
    await toolFiber.dispose()
    await promptFiber.dispose()
  })

  it('commits selection after final success and preserves a recoverable canonical result', async () => {
    const ctx = new Context()
    const promptFiber = ctx.plugin(SystemPrompt, {})
    await promptFiber.await()
    const toolFiber = ctx.plugin(ToolRuntime, { mode: 'native' })
    await toolFiber.await()
    ctx.provide('agents', { list: () => [] } as never)

    ctx.tools.register(defineTool({
      name: 'browser_take_screenshot',
      description: 'Capture a screenshot of a browser page.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: () => Promise.resolve('captured'),
    }))

    ctx.on('tools/post-execute', async (exec, _result, next) => {
      if (exec.name !== TOOL_SEARCH_NAME) return next()
      if ((exec.arguments as { query?: string }).query?.includes('blocked') === true) {
        return { kind: 'block', feedback: [{ type: 'text', text: 'blocked after body' }] }
      }
      return { kind: 'accept', content: [{ type: 'text', text: 'post-execute replacement' }] }
    })

    const agent = {
      id: 'search-commit-agent',
      session: { events: [] },
      ctx: { on: () => () => {} },
    } as unknown as Agent
    const search = new ToolSearchRuntime(ctx, {
      defaultLimit: 5,
      alwaysVisible: [],
      neverSearch: [],
    })
    ctx.tools.register(search.definition)
    const disposeSearch = search.install()

    const blocked = await ctx.tools.execute({
      callId: 'blocked-search' as never,
      name: TOOL_SEARCH_NAME,
      arguments: { query: 'browser screenshot blocked', limit: 1 },
      agent,
      signal: new AbortController().signal,
    })
    expect(blocked.isError).toBe(true)
    expect([...search.selectedFor(agent)]).toEqual([])

    const accepted = await ctx.tools.execute({
      callId: 'accepted-search' as never,
      name: TOOL_SEARCH_NAME,
      arguments: { query: 'browser screenshot', limit: 1 },
      agent,
      signal: new AbortController().signal,
    })
    expect(accepted.isError).toBe(false)
    expect([...search.selectedFor(agent)]).toEqual(['browser_take_screenshot'])
    const text = accepted.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).not.toBe('post-execute replacement')
    expect(JSON.parse(text).tools[0].name).toBe('browser_take_screenshot')

    const resumedAgent = {
      id: 'resumed-search-agent',
      session: {
        events: [{
          type: 'tool/call',
          data: { callId: 'accepted-search', name: TOOL_SEARCH_NAME, arguments: '{"query":"browser screenshot"}' },
        }, {
          type: 'tool/result',
          data: {
            message: {
              content: [{
                type: 'tool-result',
                toolCallId: 'accepted-search',
                isError: false,
                content: accepted.content,
              }],
            },
          },
        }],
      },
      ctx: { on: () => () => {} },
    } as unknown as Agent
    expect([...search.selectedFor(resumedAgent)]).toEqual(['browser_take_screenshot'])

    disposeSearch()
    await toolFiber.dispose()
    await promptFiber.dispose()
  })
})
