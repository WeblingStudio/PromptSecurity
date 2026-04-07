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

  // Confidence increases with number of flags detected
  let confidence = 0.5  // Moderate baseline
  if (flags === 0) {
    confidence = 0.8  // Pretty confident when no flags found
  } else if (flags >= 4) {
    confidence = 1.0  // Very confident when many flags
  } else {
    confidence = 0.7 + flags * 0.1  // Scale with flags: 0.8, 0.9, 1.0
  }

  return { score: normalize(flags / 4), detail: flags ? [`unicode_flags_${flags}`] : [], confidence }
}
