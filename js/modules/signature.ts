import { ModuleScore } from "../types"
import { signaturePatterns } from "../data"
import { normalize } from "../core/embedding"

type trie_node = { next: Record<string, trie_node>; end?: string[] }

const make_trie = (phrases: string[]): trie_node => {
  const root: trie_node = { next: {} }
  for (const raw of phrases) {
    const w = raw.toLowerCase()
    let cur = root
    for (const ch of w) {
      cur = cur.next[ch] ?? (cur.next[ch] = { next: {} })
    }
    ; (cur.end ??= []).push(w)
  }
  return root
}

const sig_trie = make_trie(signaturePatterns)

const scan_trie = (txt: string): string[] => {
  const hits = new Set<string>()
  const lo = txt.toLowerCase()
  for (let i = 0; i < lo.length; i++) {
    let cur = sig_trie
    let j = i
    while (j < lo.length) {
      const ch = lo[j]
      const nxt = cur.next[ch]
      if (!nxt) break
      cur = nxt
      if (cur.end) cur.end.forEach(s => hits.add(s))
      j++
    }
  }
  return [...hits]
}

const collapse_repeats = (s: string): string => {
  let result = ''
  let prev = '', prevPrev = ''
  for (const ch of s) {
    if (ch === prev && ch === prevPrev) continue
    result += ch
    prevPrev = prev
    prev = ch
  }
  return result
}

const normalize_for_fuzzy = (s: string): string =>
  collapse_repeats(s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim())

const char_trigrams = (s: string): Set<string> => {
  const t = new Set<string>()
  for (let i = 0; i <= s.length - 3; i++) {
    t.add(s.slice(i, i + 3))
  }
  return t
}

interface PatternTrigramEntry {
  trigrams: Set<string>
  pattern: string
  size: number
}

const pattern_trigram_data: PatternTrigramEntry[] = signaturePatterns.map(p => {
  const norm = normalize_for_fuzzy(p)
  const trigrams = char_trigrams(norm)
  return { trigrams, pattern: p, size: trigrams.size }
})

const trigram_index = new Map<string, number[]>()
pattern_trigram_data.forEach((ptd, idx) => {
  for (const tri of ptd.trigrams) {
    const list = trigram_index.get(tri)
    if (list) list.push(idx)
    else trigram_index.set(tri, [idx])
  }
})

const fuzzy_hits = (txt: string): { phrase: string; sim: number }[] => {
  const norm = normalize_for_fuzzy(txt)
  const input_tris = char_trigrams(norm)

  const hit_counts = new Map<number, number>()
  for (const tri of input_tris) {
    const indices = trigram_index.get(tri)
    if (indices) {
      for (const idx of indices) {
        hit_counts.set(idx, (hit_counts.get(idx) ?? 0) + 1)
      }
    }
  }

  const results: { phrase: string; sim: number }[] = []
  for (const [idx, count] of hit_counts) {
    const ptd = pattern_trigram_data[idx]
    if (ptd.size === 0) continue
    const containment = count / ptd.size
    const threshold = ptd.size < 15 ? 0.88 : 0.78
    if (containment >= threshold) {
      results.push({ phrase: ptd.pattern, sim: containment })
    }
  }

  return results
}

export const score_signatures = (txt: string): ModuleScore => {
  let exact = scan_trie(txt)

  const collapsed = collapse_repeats(txt)
  if (collapsed !== txt) {
    const extra = scan_trie(collapsed)
    for (const h of extra) {
      if (!exact.includes(h)) exact.push(h)
    }
  }

  const fuzzy = fuzzy_hits(txt)
  const reasons: string[] = []
  if (exact.length) reasons.push("direct_signature_" + exact[0])
  if (fuzzy.length) reasons.push("fuzzy_signature_" + fuzzy[0].phrase)
  const ex_score = exact.length ? Math.min(1, 0.6 + 0.1 * (exact.length - 1)) : 0
  const f_best = fuzzy.reduce((m, v) => Math.max(m, v.sim), 0)
  const f_threshold = f_best >= 0.88 ? 0.88 : 0.78
  const f_score = f_best >= f_threshold ? ((f_best - f_threshold) / (1 - f_threshold)) * 0.6 : 0

  let confidence = 0.3
  if (exact.length > 0) {
    confidence = 1.0
  } else if (fuzzy.length > 0) {
    confidence = 0.85 + (f_best - f_threshold) * 0.5
  }

  return { score: normalize(ex_score + f_score), detail: reasons, confidence }
}
