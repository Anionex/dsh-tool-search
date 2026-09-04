/** DSH Web settings surface for deferred tool policy. */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  DEFAULT_CORE_TOOLS,
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  TOOL_SEARCH_CATALOG_ROUTE,
  TOOL_SEARCH_NAME,
  TOOL_SEARCH_SETTINGS_NAMESPACE,
  type CatalogSnapshot,
  type ToolPolicy,
  type ToolSearchSettings,
} from '../shared.ts'

interface SettingsScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  writable: boolean
}

interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}

type Disposer = () => void

interface ClientContext {
  effect(setup: () => Disposer | void, label: string): void
  locale: {
    register(namespace: string, catalogs: Record<string, Record<string, string>>): Disposer
    bind(namespace: string): (key: string) => string
  }
  settingsScope: {
    bind<T>(options: { namespace: string }): SettingsScope<T>
  }
  slots: {
    inject(name: string, callback: () => Disposer): Disposer
    register<P>(
      options: {
        name: string
        id: string
        order: number
        label: () => string
        inject: () => P
      },
      component: (props: P) => ReactNode,
    ): Disposer
  }
}

type Translate = (key: keyof typeof en) => string

const en = {
  nav: 'Tool Search',
  topK: 'Default results',
  alwaysVisible: 'Always visible',
  neverSearch: 'Never searchable',
  catalog: 'Tool catalog',
  filter: 'Filter tools',
  refresh: 'Refresh',
  tool: 'Tool',
  policy: 'Policy',
  selected: 'Live agents',
  defaultPolicy: 'Default',
  alwaysPolicy: 'Always',
  blockedPolicy: 'Blocked',
  loading: 'Loading...',
  empty: 'No matching tools',
  saved: 'Saved',
  onePerLine: 'One exact tool name per line',
}

const zh: typeof en = {
  nav: '工具搜索',
  topK: '默认结果数',
  alwaysVisible: '常驻白名单',
  neverSearch: '搜索黑名单',
  catalog: '工具目录',
  filter: '筛选工具',
  refresh: '刷新',
  tool: '工具',
  policy: '策略',
  selected: '活跃 Agent',
  defaultPolicy: '默认',
  alwaysPolicy: '常驻',
  blockedPolicy: '禁用',
  loading: '加载中...',
  empty: '没有匹配工具',
  saved: '已保存',
  onePerLine: '每行一个精确工具名',
}

const EMPTY_SETTINGS: SettingsScopeSnapshot<ToolSearchSettings> = {
  status: 'unavailable',
  value: undefined,
  writable: false,
}

const styles = `
.dts-settings{container-type:inline-size;display:flex;flex-direction:column;gap:20px;width:100%;min-width:0;color:var(--dsw-alias-label-primary)}
.dts-toolbar{display:grid;grid-template-columns:minmax(160px,220px) minmax(220px,1fr) auto;align-items:end;gap:12px}
.dts-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dts-field>span,.dts-section-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dts-input,.dts-textarea,.dts-select{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
.dts-input,.dts-select{height:34px;padding:0 9px}.dts-textarea{min-height:104px;padding:8px 9px;resize:vertical;line-height:20px}
.dts-input:focus,.dts-textarea:focus,.dts-select:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dts-lists{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.dts-hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dts-button{height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.dts-button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dts-button:disabled{opacity:.5;cursor:not-allowed}
.dts-status{min-height:18px;font-size:12px;color:var(--dsw-alias-label-secondary)}.dts-status[data-error=true]{color:var(--dsw-alias-state-error-primary)}
.dts-table-wrap{min-width:0;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2)}
.dts-table{width:100%;min-width:620px;border-collapse:collapse;table-layout:fixed}
.dts-table th,.dts-table td{box-sizing:border-box;padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);text-align:left;vertical-align:middle;font-size:12px}
.dts-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-weight:600}
.dts-table tr:last-child td{border-bottom:0}.dts-tool{width:52%}.dts-tool code{display:block;overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dts-description{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}
.dts-policy{width:26%}.dts-selected{width:22%;color:var(--dsw-alias-label-secondary)}
@container(max-width:620px){.dts-toolbar{grid-template-columns:1fr auto}.dts-toolbar .dts-limit{grid-column:1/-1}.dts-lists{grid-template-columns:1fr}.dts-table{min-width:0}.dts-table thead{display:none}.dts-table tr{display:grid;grid-template-columns:minmax(0,1fr) 132px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.dts-table td{padding:4px 0;border:0}.dts-table .dts-tool,.dts-table .dts-policy{width:auto}.dts-table .dts-selected{grid-column:1/-1;width:auto;font-size:11px}.dts-table .dts-selected::before{content:attr(data-label) ": ";color:var(--dsw-alias-label-tertiary);font-weight:600}}
`

function namesFromText(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map(name => name.trim()).filter(Boolean))].sort()
}

function overrideFor(name: string, settings: ToolSearchSettings): ToolPolicy | 'default' {
  if (settings.neverSearch.includes(name)) return 'blocked'
  if (settings.alwaysVisible.includes(name)) return 'always'
  return 'default'
}

function decodeCatalog(value: unknown): CatalogSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid catalog response')
  const record = value as Record<string, unknown>
  if (record['schemaVersion'] !== 1 || !Array.isArray(record['tools']) || typeof record['generation'] !== 'number') {
    throw new Error('Invalid catalog response')
  }
  return value as CatalogSnapshot
}

type SettingsProps = {
  scope?: SettingsScope<ToolSearchSettings>
  t?: Translate
}

export function ToolSearchSettingsSection({ scope, t }: SettingsProps): ReactNode {
  const snapshot = useSyncExternalStore(
    useCallback((notify: () => void) => scope?.subscribe(notify) ?? (() => {}), [scope]),
    useCallback(() => scope?.getSnapshot() ?? EMPTY_SETTINGS, [scope]),
  )
  const [catalog, setCatalog] = useState<CatalogSnapshot>()
  const [filter, setFilter] = useState('')
  const [alwaysText, setAlwaysText] = useState('')
  const [blockedText, setBlockedText] = useState('')
  const [limitText, setLimitText] = useState(String(DEFAULT_RESULT_LIMIT))
  const [status, setStatus] = useState<{ text: string; error: boolean }>()
  const translate = t ?? ((key: keyof typeof en) => en[key])
  const settings = snapshot.value

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(TOOL_SEARCH_CATALOG_ROUTE, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setCatalog(decodeCatalog(await response.json()))
      setStatus(undefined)
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), error: true })
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (settings === undefined) return
    setAlwaysText(settings.alwaysVisible.join('\n'))
    setBlockedText(settings.neverSearch.join('\n'))
    setLimitText(String(settings.defaultLimit))
  }, [settings])

  const commit = useCallback((field: keyof ToolSearchSettings, value: unknown): void => {
    if (scope === undefined || !snapshot.writable) return
    setStatus(undefined)
    void scope.set(field, value).then(() => {
      setStatus({ text: translate('saved'), error: false })
      void refresh()
    }, error => {
      setStatus({ text: error instanceof Error ? error.message : String(error), error: true })
    })
  }, [refresh, scope, snapshot.writable, translate])

  const visibleTools = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (query.length === 0) return catalog?.tools ?? []
    return (catalog?.tools ?? []).filter(tool =>
      tool.name.toLowerCase().includes(query) || tool.description.toLowerCase().includes(query),
    )
  }, [catalog, filter])

  const changePolicy = (name: string, next: ToolPolicy | 'default'): void => {
    if (settings === undefined || name === TOOL_SEARCH_NAME) return
    const always = new Set(settings.alwaysVisible)
    const blocked = new Set(settings.neverSearch)
    always.delete(name)
    blocked.delete(name)
    if (next === 'always') always.add(name)
    if (next === 'blocked') blocked.add(name)
    commit('alwaysVisible', [...always].sort())
    commit('neverSearch', [...blocked].sort())
  }

  const core = new Set<string>(DEFAULT_CORE_TOOLS)
  return <div className="dts-settings">
    <div className="dts-toolbar">
      <label className="dts-field dts-limit">
        <span>{translate('topK')}</span>
        <input
          className="dts-input"
          type="number"
          min={1}
          max={MAX_RESULT_LIMIT}
          value={limitText}
          disabled={!snapshot.writable}
          onChange={event => setLimitText(event.target.value)}
          onBlur={() => {
            const value = Number.parseInt(limitText, 10)
            if (Number.isSafeInteger(value) && value >= 1 && value <= MAX_RESULT_LIMIT) commit('defaultLimit', value)
            else setLimitText(String(settings?.defaultLimit ?? DEFAULT_RESULT_LIMIT))
          }}
        />
      </label>
      <label className="dts-field">
        <span>{translate('filter')}</span>
        <input className="dts-input" type="search" value={filter} onChange={event => setFilter(event.target.value)} />
      </label>
      <button className="dts-button" type="button" onClick={() => { void refresh() }}>{translate('refresh')}</button>
    </div>

    <div className="dts-lists">
      <label className="dts-field">
        <span>{translate('alwaysVisible')}</span>
        <textarea
          className="dts-textarea"
          value={alwaysText}
          disabled={!snapshot.writable}
          placeholder={translate('onePerLine')}
          onChange={event => setAlwaysText(event.target.value)}
          onBlur={() => commit('alwaysVisible', namesFromText(alwaysText))}
        />
      </label>
      <label className="dts-field">
        <span>{translate('neverSearch')}</span>
        <textarea
          className="dts-textarea"
          value={blockedText}
          disabled={!snapshot.writable}
          placeholder={translate('onePerLine')}
          onChange={event => setBlockedText(event.target.value)}
          onBlur={() => commit('neverSearch', namesFromText(blockedText).filter(name => name !== TOOL_SEARCH_NAME))}
        />
      </label>
    </div>

    <section className="dts-field">
      <div className="dts-section-title">{translate('catalog')}</div>
      <div className="dts-table-wrap">
        <table className="dts-table">
          <thead><tr>
            <th className="dts-tool">{translate('tool')}</th>
            <th className="dts-policy">{translate('policy')}</th>
            <th className="dts-selected">{translate('selected')}</th>
          </tr></thead>
          <tbody>
            {visibleTools.map(tool => <tr key={tool.name}>
              <td className="dts-tool">
                <code title={tool.name}>{tool.name}</code>
                {tool.description.length > 0 ? <span className="dts-description" title={tool.description}>{tool.description}</span> : null}
              </td>
              <td className="dts-policy">
                <select
                  className="dts-select"
                  aria-label={`${translate('policy')}: ${tool.name}`}
                  value={tool.name === TOOL_SEARCH_NAME ? 'always' : overrideFor(tool.name, settings ?? {
                    defaultLimit: DEFAULT_RESULT_LIMIT,
                    alwaysVisible: [],
                    neverSearch: [],
                  })}
                  disabled={!snapshot.writable || tool.name === TOOL_SEARCH_NAME}
                  onChange={event => changePolicy(tool.name, event.target.value as ToolPolicy | 'default')}
                >
                  <option value="default">{core.has(tool.name) ? `${translate('defaultPolicy')} (${translate('alwaysPolicy')})` : translate('defaultPolicy')}</option>
                  <option value="always">{translate('alwaysPolicy')}</option>
                  <option value="blocked">{translate('blockedPolicy')}</option>
                </select>
              </td>
              <td
                className="dts-selected"
                data-label={translate('selected')}
                aria-label={`${translate('selected')}: ${tool.selectedBy.length}`}
              >{tool.selectedBy.length}</td>
            </tr>)}
            {catalog !== undefined && visibleTools.length === 0
              ? <tr><td colSpan={3}>{translate('empty')}</td></tr>
              : null}
          </tbody>
        </table>
      </div>
      <div className="dts-status" data-error={status?.error || undefined}>
        {status?.text ?? (catalog === undefined ? translate('loading') : '')}
      </div>
    </section>
  </div>
}

export const inject = ['slots', 'locale', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    if (document.querySelector('style[data-plugin-css="@anionex/dsh-tool-search"]') !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.pluginCss = '@anionex/dsh-tool-search'
    tag.textContent = styles
    document.head.append(tag)
    return () => tag.remove()
  }, 'dsh-tool-search: styles')
  ctx.effect(() => ctx.locale.register('settings.toolSearch', { en, zh }), 'dsh-tool-search: locale')
  const t = ctx.locale.bind('settings.toolSearch') as Translate
  const scope = ctx.settingsScope.bind<ToolSearchSettings>({ namespace: TOOL_SEARCH_SETTINGS_NAMESPACE })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'tool-search',
    order: 34,
    label: () => t('nav'),
    inject: () => ({ scope, t }),
  }, ToolSearchSettingsSection))
}
