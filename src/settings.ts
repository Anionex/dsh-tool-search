/** Validated Host settings and policy resolution. */

import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_CORE_TOOLS,
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  TOOL_SEARCH_NAME,
  TOOL_SEARCH_SETTINGS_NAMESPACE,
  type ToolPolicy,
  type ToolSearchSettings,
} from './shared.ts'

export const TOOL_SEARCH_SETTINGS_NS = TOOL_SEARCH_SETTINGS_NAMESPACE as SettingsNamespace

export const Config: z<ToolSearchSettings> = z.object({
  defaultLimit: z.number().step(1).min(1).max(MAX_RESULT_LIMIT).default(DEFAULT_RESULT_LIMIT),
  alwaysVisible: z.array(z.string()).default([]),
  neverSearch: z.array(z.string()).default([]),
})

function normalizeNames(names: readonly string[]): string[] {
  const normalized = new Set<string>()
  for (const value of names) {
    const name = value.trim()
    if (name.length > 0) normalized.add(name)
  }
  return [...normalized].sort()
}

export function normalizeSettings(value: ToolSearchSettings): ToolSearchSettings {
  const defaultLimit = Number.isSafeInteger(value.defaultLimit)
    ? Math.min(MAX_RESULT_LIMIT, Math.max(1, value.defaultLimit))
    : DEFAULT_RESULT_LIMIT
  return {
    defaultLimit,
    alwaysVisible: normalizeNames(value.alwaysVisible),
    neverSearch: normalizeNames(value.neverSearch).filter(name => name !== TOOL_SEARCH_NAME),
  }
}

export class ToolPolicyResolver {
  private readonly core = new Set<string>(DEFAULT_CORE_TOOLS)
  private always = new Set<string>()
  private blocked = new Set<string>()

  constructor(settings: ToolSearchSettings) {
    this.update(settings)
  }

  update(settings: ToolSearchSettings): void {
    this.always = new Set(settings.alwaysVisible)
    this.blocked = new Set(settings.neverSearch)
  }

  classify(name: string, selected?: ReadonlySet<string>): ToolPolicy {
    if (name === TOOL_SEARCH_NAME) return 'always'
    if (this.blocked.has(name)) return 'blocked'
    if (this.core.has(name) || this.always.has(name) || selected?.has(name) === true) return 'always'
    return 'deferred'
  }
}
