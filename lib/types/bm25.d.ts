/** Deterministic local BM25, aligned with Codex's bm25 2.3.2 defaults. */
export declare function tokenize(value: string): string[];
export interface Bm25Document<T> {
    id: T;
    name: string;
    text: string;
}
export interface Bm25Match<T> {
    id: T;
    name: string;
    score: number;
}
export declare class Bm25Index<T> {
    private readonly documents;
    private readonly frequencies;
    private readonly averageLength;
    constructor(documents: readonly Bm25Document<T>[]);
    search(query: string, limit: number): Bm25Match<T>[];
}
//# sourceMappingURL=bm25.d.ts.map