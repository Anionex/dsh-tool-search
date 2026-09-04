/** DSH bundle entry for Codex-style deferred tool loading. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { ToolSearchRuntime } from './runtime.ts'
import { Config, TOOL_SEARCH_SETTINGS_NS } from './settings.ts'
import type { ToolSearchSettings } from './shared.ts'
import { installCatalogRoute } from './web.ts'

export const name = '@anionex/dsh-tool-search'
export const inject = ['agents', 'tools', 'systemPrompt', 'settings']
export { Config }

export function apply(ctx: Context, config: ToolSearchSettings): void {
  const settings = ctx.settings.register(TOOL_SEARCH_SETTINGS_NS, Config, {
    base: config,
    applies: 'live',
  })
  const runtime = new ToolSearchRuntime(ctx, settings.get())
  ctx.tools.register(runtime.definition)
  ctx.effect(() => runtime.install(), 'dsh-tool-search: agent visibility')
  ctx.effect(() => settings.watch(next => { runtime.updateSettings(next) }), 'dsh-tool-search: settings')
  installCatalogRoute(ctx, runtime)
}

export { Bm25Index, tokenize } from './bm25.ts'
export { appendSchemaSearchText, buildCatalog, toolSearchText } from './catalog.ts'
export { ToolSearchRuntime } from './runtime.ts'
export { normalizeSettings, ToolPolicyResolver } from './settings.ts'
export * from './shared.ts'
