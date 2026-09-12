/** Agent-local selected sets and model-visible tool filtering. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type CatalogSnapshot, type ToolSearchSettings } from './shared.ts';
export interface ToolSearchMatch {
    name: string;
    description: string;
    score: number;
}
export interface ToolSearchResult {
    schemaVersion: 1;
    query: string;
    tools: ToolSearchMatch[];
}
export declare class ToolSearchRuntime {
    private readonly ctx;
    readonly definition: ToolDefinition;
    private readonly states;
    private readonly policy;
    private settings;
    private generation;
    constructor(ctx: Context, settings: ToolSearchSettings);
    install(): () => void;
    updateSettings(value: ToolSearchSettings): void;
    snapshot(): CatalogSnapshot;
    selectedFor(agent: Agent): ReadonlySet<string>;
    private createDefinition;
    private search;
    private commitSelection;
    private attach;
    private detach;
    private requireState;
    /**
     * The searchable registry view for one Agent: every tool it could reach,
     * whether or not the current presentation shows it.
     *
     * The reserved PTC transport is excluded: it is never searchable, never
     * constrained by policy, and never part of the generated SDK it carries.
     * Reading the registry (rather than the assembled schemas) is what keeps the
     * corpus complete under PTC presentation, where the assembly itself carries
     * only `run_code`.
     */
    private refreshCatalog;
    /**
     * Hide every deferred tool from one final assembly.
     *
     * Two surfaces carry tools and both must agree: the native schema list plus
     * its `tool:<name>` guidance sections, and — under `ptc`/`both` — the
     * generated `tools:sdk` section. The SDK text is regenerated with the same
     * renderer `dsh-tools` uses, from the surviving tools alone, so the filtered
     * assembly is byte-identical to the one the registry would have built for
     * that smaller tool set.
     */
    private filterAssembly;
    /**
     * Rebuild the PTC SDK section for the surviving tools.
     *
     * The flavor must be the one the session already programs against, so it
     * comes from the mounted code runtime; a host that cannot answer for it
     * falls back to the marker the existing section was rendered with.
     */
    private renderSdk;
    private resolveSdkRenderer;
    private codeRuntime;
    private toolDefinition;
}
//# sourceMappingURL=runtime.d.ts.map