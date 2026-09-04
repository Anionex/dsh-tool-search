/** Validated Host settings and policy resolution. */
import z from '@deepseek-ai/schemastery';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';
import { type ToolPolicy, type ToolSearchSettings } from './shared.ts';
export declare const TOOL_SEARCH_SETTINGS_NS: SettingsNamespace;
export declare const Config: z<ToolSearchSettings>;
export declare function normalizeSettings(value: ToolSearchSettings): ToolSearchSettings;
export declare class ToolPolicyResolver {
    private readonly core;
    private always;
    private blocked;
    constructor(settings: ToolSearchSettings);
    update(settings: ToolSearchSettings): void;
    classify(name: string, selected?: ReadonlySet<string>): ToolPolicy;
}
//# sourceMappingURL=settings.d.ts.map