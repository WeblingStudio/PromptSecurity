import { ModuleScore } from "../types"
import { unicodeRanges } from "../data"
import { normalize } from "../core/embedding"

const unicode_flags = (txt: string) => {
  let flags = 0
  for (const ch of txt) {
    const code = ch.codePointAt(0)!
    if (unicodeRanges.hidden_ranges.some(([s, e]) => code >= s && code <= e)) flags++
    else if (unicodeRanges.homoglyph_blocks.some(([s, e]) => code >= s && code <= e)) flags++
    if (flags >= 4) break
  }
  return flags
}

export const score_unicode = (txt: string): ModuleScore => {
  const flags = unicode_flags(txt)
  return { score: normalize(flags / 4), detail: flags ? [`unicode_flags_${flags}`] : [] }
}
