// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToolSearchSettingsSection } from '../src/client/index.tsx'
import type { ToolSearchSettings } from '../src/shared.ts'

describe('Tool Search settings section', () => {
  it('renders the live catalog and persists policy changes', async () => {
    const set = vi.fn(() => Promise.resolve())
    const value: ToolSearchSettings = { defaultLimit: 5, alwaysVisible: [], neverSearch: [] }
    const snapshot = { status: 'ready' as const, value, writable: true }
    const scope = {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      set,
    }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      schemaVersion: 1,
      generation: 2,
      tools: [{
        name: 'browser_take_screenshot',
        description: 'Capture a browser screenshot.',
        policy: 'deferred',
        selectedBy: [],
      }],
    }), { status: 200 }))))

    render(<ToolSearchSettingsSection scope={scope} />)
    expect(await screen.findByText('browser_take_screenshot')).toBeDefined()
    expect(screen.getByLabelText('Live agents: 0').getAttribute('data-label')).toBe('Live agents')
    fireEvent.change(screen.getByLabelText('Policy: browser_take_screenshot'), { target: { value: 'always' } })
    await waitFor(() => {
      expect(set).toHaveBeenCalledWith('alwaysVisible', ['browser_take_screenshot'])
      expect(set).toHaveBeenCalledWith('neverSearch', [])
    })
    vi.unstubAllGlobals()
  })
})
