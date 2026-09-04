/** DSH bundle entry for Codex-style deferred tool loading. */
import { ToolSearchRuntime } from "./runtime.js";
import { Config, TOOL_SEARCH_SETTINGS_NS } from "./settings.js";
import { installCatalogRoute } from "./web.js";
export const name = '@anionex/dsh-tool-search';
export const inject = ['agents', 'tools', 'systemPrompt', 'settings'];
export { Config };
export function apply(ctx, config) {
    const settings = ctx.settings.register(TOOL_SEARCH_SETTINGS_NS, Config, {
        base: config,
        applies: 'live',
    });
    const runtime = new ToolSearchRuntime(ctx, settings.get());
    ctx.tools.register(runtime.definition);
    ctx.effect(() => runtime.install(), 'dsh-tool-search: agent visibility');
    ctx.effect(() => settings.watch(next => { runtime.updateSettings(next); }), 'dsh-tool-search: settings');
    installCatalogRoute(ctx, runtime);
}
export { Bm25Index, tokenize } from "./bm25.js";
export { appendSchemaSearchText, buildCatalog, toolSearchText } from "./catalog.js";
export { ToolSearchRuntime } from "./runtime.js";
export { normalizeSettings, ToolPolicyResolver } from "./settings.js";
export * from "./shared.js";
//# sourceMappingURL=index.js.map