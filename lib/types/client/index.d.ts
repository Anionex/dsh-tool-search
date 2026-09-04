/** DSH Web settings surface for deferred tool policy. */
import { type ReactNode } from 'react';
import { type ToolSearchSettings } from '../shared.ts';
interface SettingsScopeSnapshot<T> {
    status: 'loading' | 'ready' | 'unavailable';
    value: T | undefined;
    writable: boolean;
}
interface SettingsScope<T> {
    getSnapshot(): SettingsScopeSnapshot<T>;
    subscribe(listener: () => void): () => void;
    set(field: string, value: unknown): Promise<void>;
}
type Disposer = () => void;
interface ClientContext {
    effect(setup: () => Disposer | void, label: string): void;
    locale: {
        register(namespace: string, catalogs: Record<string, Record<string, string>>): Disposer;
        bind(namespace: string): (key: string) => string;
    };
    settingsScope: {
        bind<T>(options: {
            namespace: string;
        }): SettingsScope<T>;
    };
    slots: {
        inject(name: string, callback: () => Disposer): Disposer;
        register<P>(options: {
            name: string;
            id: string;
            order: number;
            label: () => string;
            inject: () => P;
        }, component: (props: P) => ReactNode): Disposer;
    };
}
type Translate = (key: keyof typeof en) => string;
declare const en: {
    nav: string;
    topK: string;
    alwaysVisible: string;
    neverSearch: string;
    catalog: string;
    filter: string;
    refresh: string;
    tool: string;
    policy: string;
    selected: string;
    defaultPolicy: string;
    alwaysPolicy: string;
    blockedPolicy: string;
    loading: string;
    empty: string;
    saved: string;
    onePerLine: string;
};
type SettingsProps = {
    scope?: SettingsScope<ToolSearchSettings>;
    t?: Translate;
};
export declare function ToolSearchSettingsSection({ scope, t }: SettingsProps): ReactNode;
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map