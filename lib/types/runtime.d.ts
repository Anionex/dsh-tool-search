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
    private refreshCatalog;
    private filterAssembly;
}
//# sourceMappingURL=runtime.d.ts.map