/** DSH bundle entry for Codex-style deferred tool loading. */
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './settings.ts';
import type { ToolSearchSettings } from './shared.ts';
export declare const name = "@anionex/dsh-tool-search";
export declare const inject: string[];
export { Config };
export declare function apply(ctx: Context, config: ToolSearchSettings): void;
export { Bm25Index, tokenize } from './bm25.ts';
export { appendSchemaSearchText, buildCatalog, toolSearchText } from './catalog.ts';
export { ToolSearchRuntime } from './runtime.ts';
export { normalizeSettings, ToolPolicyResolver } from './settings.ts';
export * from './shared.ts';
//# sourceMappingURL=index.d.ts.map