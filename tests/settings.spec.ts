import { describe, expect, it } from 'vitest'
import { ToolPolicyResolver, normalizeSettings } from '../src/settings.ts'
import { TOOL_SEARCH_NAME } from '../src/shared.ts'

describe('tool exposure policy', () => {
  it('normalizes exact-name lists deterministically', () => {
    expect(normalizeSettings({
      defaultLimit: 200,
      alwaysVisible: [' zeta ', 'alpha', '', 'alpha'],
      neverSearch: ['danger', TOOL_SEARCH_NAME, 'danger'],
    })).toEqual({
      defaultLimit: 20,
      alwaysVisible: ['alpha', 'zeta'],
      neverSearch: ['danger'],
    })
  })

  it('keeps core tools visible, defers long-tail tools, and lets blacklist win', () => {
    const policy = new ToolPolicyResolver({
      defaultLimit: 5,
      alwaysVisible: ['custom_tool', 'conflict_tool'],
      neverSearch: ['conflict_tool', 'bash'],
    })
    expect(policy.classify(TOOL_SEARCH_NAME)).toBe('always')
    expect(policy.classify('apply_patch')).toBe('always')
    expect(policy.classify('report')).toBe('always')
    expect(policy.classify('dsh_im_return_file')).toBe('deferred')
    expect(policy.classify('bash')).toBe('blocked')
    expect(policy.classify('custom_tool')).toBe('always')
    expect(policy.classify('conflict_tool')).toBe('blocked')
    expect(policy.classify('browser_take_screenshot')).toBe('deferred')
    expect(policy.classify('browser_take_screenshot', new Set(['browser_take_screenshot']))).toBe('always')
  })
})
