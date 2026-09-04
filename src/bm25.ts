/** Deterministic local BM25, aligned with Codex's bm25 2.3.2 defaults. */

import stem from 'wink-porter2-stemmer'

const K1 = 1.2
const B = 0.75

// stop-words 0.9.0 uses the NLTK English list before stemming.
const ENGLISH_STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'ain', 'all', 'am', 'an', 'and', 'any', 'are',
  'aren', "aren't", 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both',
  'but', 'by', 'can', 'couldn', "couldn't", 'd', 'did', 'didn', "didn't", 'do', 'does', 'doesn',
  "doesn't", 'doing', 'don', "don't", 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had',
  'hadn', "hadn't", 'has', 'hasn', "hasn't", 'have', 'haven', "haven't", 'having', 'he', 'her', 'here',
  'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'isn', "isn't",
  'it', "it's", 'its', 'itself', 'just', 'll', 'm', 'ma', 'me', 'mightn', "mightn't", 'more', 'most',
  'mustn', "mustn't", 'my', 'myself', 'needn', "needn't", 'no', 'nor', 'not', 'now', 'o', 'of', 'off',
  'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 're', 's',
  'same', 'shan', "shan't", 'she', "she's", 'should', "should've", 'shouldn', "shouldn't", 'so', 'some',
  'such', 't', 'than', 'that', "that'll", 'the', 'their', 'theirs', 'them', 'themselves', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 've',
  'very', 'was', 'wasn', "wasn't", 'we', 'were', 'weren', "weren't", 'what', 'when', 'where', 'which',
  'while', 'who', 'whom', 'why', 'will', 'with', 'won', "won't", 'wouldn', "wouldn't", 'y', 'you',
  "you'd", "you'll", "you're", "you've", 'your', 'yours', 'yourself', 'yourselves',
])

function asciiFold(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '')
}

export function tokenize(value: string): string[] {
  const matches = asciiFold(value).toLowerCase().match(/[\p{L}\p{N}]+(?:['.][\p{L}\p{N}]+)*/gu) ?? []
  return matches.filter(token => !ENGLISH_STOP_WORDS.has(token)).map(token => stem(token))
}

export interface Bm25Document<T> {
  id: T
  name: string
  text: string
}

export interface Bm25Match<T> {
  id: T
  name: string
  score: number
}

interface IndexedDocument<T> extends Bm25Document<T> {
  tokens: string[]
  counts: Map<string, number>
  order: number
}

export class Bm25Index<T> {
  private readonly documents: IndexedDocument<T>[]
  private readonly frequencies = new Map<string, number>()
  private readonly averageLength: number

  constructor(documents: readonly Bm25Document<T>[]) {
    this.documents = documents.map((document, order) => {
      const tokens = tokenize(document.text)
      const counts = new Map<string, number>()
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
      for (const token of counts.keys()) this.frequencies.set(token, (this.frequencies.get(token) ?? 0) + 1)
      return { ...document, tokens, counts, order }
    })
    this.averageLength = this.documents.length === 0
      ? 256
      : this.documents.reduce((total, document) => total + document.tokens.length, 0) / this.documents.length
  }

  search(query: string, limit: number): Bm25Match<T>[] {
    if (limit <= 0 || this.documents.length === 0) return []
    const queryTokens = tokenize(query)
    const normalizedQuery = query.trim()
    const matches: Array<Bm25Match<T> & { exact: boolean; order: number }> = []

    for (const document of this.documents) {
      let score = 0
      for (const token of queryTokens) {
        const termFrequency = document.counts.get(token) ?? 0
        if (termFrequency === 0) continue
        const documentFrequency = this.frequencies.get(token) ?? 0
        const inverseDocumentFrequency = Math.log1p(
          (this.documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5),
        )
        const lengthRatio = document.tokens.length / this.averageLength
        const weight = (termFrequency * (K1 + 1))
          / (termFrequency + K1 * (1 - B + B * lengthRatio))
        score += inverseDocumentFrequency * weight
      }
      const exact = document.name === normalizedQuery
      if (score > 0 || exact) matches.push({ id: document.id, name: document.name, score, exact, order: document.order })
    }

    matches.sort((left, right) => {
      if (left.exact !== right.exact) return left.exact ? -1 : 1
      if (left.score !== right.score) return right.score - left.score
      if (left.name !== right.name) return left.name < right.name ? -1 : 1
      return left.order - right.order
    })
    return matches.slice(0, limit).map(({ id, name, score }) => ({ id, name, score }))
  }
}
