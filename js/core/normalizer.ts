import { unicodeRanges } from "../data"

export type ObfuscationType =
  | 'leetspeak'        // l33t → leet
  | 'token_split'      // 'i g n o r e' → 'ignore'
  | 'base64'           // 'aWdub3Jl' → 'ignore'
  | 'rot13'            // 'vtaber' → 'ignore'
  | 'hex'              // '\x69\x67\x6e\x6f\x72\x65' → 'ignore'
  | 'invisible_chars'  // zero-width spaces
  | 'homoglyphs'       // existing unicode.ts detection

export interface NormalizationResult {
  normalized: string
  obfuscationScore: number
  detections: ObfuscationType[]
}

// L33t speak character mappings
const leetMap: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '|': 'l', '(': 'c', ')': 'c',
  '+': 't', '<': 'c', '>': 'c', '€': 'e', '£': 'l'
}

// Invisible Unicode characters (zero-width, formatting)
const invisibleCharRanges: [number, number][] = [
  [0x200B, 0x200F],  // Zero-width spaces, joiners, direction marks
  [0x202A, 0x202E],  // Bidirectional formatting
  [0x2060, 0x2069],  // Word joiner, invisible separators
  [0xFEFF, 0xFEFF],  // Zero-width no-break space
  [0xFFF9, 0xFFFB],  // Interlinear annotation
  [0x00AD, 0x00AD],  // Soft hyphen
]

// Homoglyph normalization (common substitutions)
const homoglyphMap: Record<string, string> = {
  // Cyrillic to Latin
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
  // Greek to Latin
  'α': 'a', 'β': 'b', 'γ': 'y', 'ε': 'e', 'ι': 'i', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'ν': 'v',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  // Mathematical alphanumeric
  '𝐀': 'A', '𝐁': 'B', '𝐂': 'C', '𝐃': 'D', '𝐄': 'E',
  '𝐚': 'a', '𝐛': 'b', '𝐜': 'c', '𝐝': 'd', '𝐞': 'e',
}

/**
 * Detects if a character is invisible or formatting-only
 */
const isInvisibleChar = (code: number): boolean => {
  return invisibleCharRanges.some(([start, end]) => code >= start && code <= end)
}

/**
 * Removes invisible Unicode characters
 */
const removeInvisibleChars = (text: string): { text: string; count: number } => {
  let count = 0
  const cleaned = Array.from(text).filter(char => {
    const code = char.codePointAt(0)!
    if (isInvisibleChar(code)) {
      count++
      return false
    }
    return true
  }).join('')
  return { text: cleaned, count }
}

/**
 * Normalizes homoglyphs to standard ASCII equivalents
 */
const normalizeHomoglyphs = (text: string): { text: string; count: number } => {
  let count = 0
  const normalized = Array.from(text).map(char => {
    const replacement = homoglyphMap[char]
    if (replacement) {
      count++
      return replacement
    }
    return char
  }).join('')
  return { text: normalized, count }
}

/**
 * Normalizes l33t speak to regular characters
 * Only applies normalization when there's clear evidence of l33t speak usage
 */
const normalizeLeetspeak = (text: string): { text: string; count: number } => {
  // Check if text has l33t speak patterns (numbers/symbols mixed with letters)
  // Don't normalize standalone numbers or legitimate uses
  const words = text.split(/\s+/)
  let count = 0

  const normalized = words.map(word => {
    // Skip pure numbers
    if (/^\d+$/.test(word)) return word

    // Skip words that look like identifiers or codes (e.g., ABC123XYZ, ID123, V2.0)
    // These have consecutive numbers that aren't meant to be l33t speak
    if (/[A-Z]{2,}\d+[A-Z]*/.test(word)) return word  // ABC123, ABC123XYZ
    if (/\d{2,}/.test(word)) return word  // Multiple consecutive digits suggest not l33t

    // Only normalize if word contains both letters and l33t chars
    const hasLetters = /[a-zA-Z]/.test(word)
    const hasLeetChars = /[0-9@$!|()<>€£+]/.test(word)

    if (!hasLetters || !hasLeetChars) return word

    // Check if multiple l33t chars are present (stronger signal)
    const leetCharCount = (word.match(/[0-9@$!|()<>€£+]/g) || []).length
    if (leetCharCount < 2 && word.length > 6) return word

    // Normalize this word
    let normalized = ''
    for (const char of word) {
      const replacement = leetMap[char]
      if (replacement) {
        count++
        normalized += replacement
      } else {
        normalized += char
      }
    }
    return normalized
  }).join(' ')

  return { text: normalized, count }
}

/**
 * Detects and reconstructs token-split words (e.g., "i g n o r e" → "ignore")
 */
const reconstructTokenSplit = (text: string): { text: string; count: number } => {
  // Pattern: single chars separated by spaces, at least 3 chars
  // Matches: "i g n o r e", "p r o m p t", etc.
  const pattern = /\b([a-z])\s+([a-z])\s+([a-z])(?:\s+[a-z])*\b/gi
  let count = 0

  const normalized = text.replace(pattern, (match) => {
    count++
    return match.replace(/\s+/g, '')
  })

  return { text: normalized, count }
}

/**
 * Detects and decodes Base64 sequences
 */
const decodeBase64Sequences = (text: string): { text: string; count: number } => {
  // Match potential Base64 strings (at least 16 chars for better confidence, valid Base64 alphabet)
  const base64Pattern = /\b[A-Za-z0-9+/]{16,}={0,2}\b/g
  let count = 0

  const decoded = text.replace(base64Pattern, (match) => {
    try {
      // Try to decode
      const decoded = Buffer.from(match, 'base64').toString('utf-8')

      // Only replace if result is ASCII printable text with actual words
      // Check for common English letters and word-like patterns
      const isPrintable = /^[\x20-\x7E]+$/.test(decoded)
      const hasVowels = /[aeiouAEIOU]/.test(decoded)
      const hasSpaces = /\s/.test(decoded)
      const reasonableLength = decoded.length >= 6

      // Must be printable, have vowels (suggests real words), and be reasonable length
      if (isPrintable && hasVowels && reasonableLength) {
        count++
        return decoded
      }
    } catch (e) {
      // Invalid Base64, keep original
    }
    return match
  })

  return { text: decoded, count }
}

/**
 * Detects and decodes ROT13 encoding
 */
const decodeROT13 = (text: string): { text: string; count: number } => {
  // ROT13 detection is tricky - we'll look for common jailbreak words encoded
  const rot13Words = ['vtaber', 'cebzcg', 'flfgrz', 'erivrj', 'npprff', 'nqzva']
  let hasROT13 = false

  const lowerText = text.toLowerCase()
  for (const word of rot13Words) {
    if (lowerText.includes(word)) {
      hasROT13 = true
      break
    }
  }

  if (!hasROT13) return { text, count: 0 }

  // Decode ROT13
  const decoded = text.replace(/[a-zA-Z]/g, char => {
    const code = char.charCodeAt(0)
    const base = code >= 97 ? 97 : 65
    return String.fromCharCode(((code - base + 13) % 26) + base)
  })

  return { text: decoded, count: 1 }
}

/**
 * Detects and decodes hex-encoded sequences
 */
const decodeHexSequences = (text: string): { text: string; count: number } => {
  // Match patterns like \x69\x67\x6e\x6f\x72\x65 or 0x69 0x67 0x6e 0x6f 0x72 0x65
  // Also match literal \\x patterns (escaped backslash)
  const hexPatterns = [
    /(?:\\x[0-9a-fA-F]{2}){3,}/g,              // \x69\x67\x6e\x6f\x72\x65
    /(?:\\\\x[0-9a-fA-F]{2}){3,}/g,            // \\x69\\x67\\x6e\\x6f\\x72\\x65 (literal backslash)
    /(?:0x[0-9a-fA-F]{2}\s*){3,}/g,            // 0x69 0x67 0x6e 0x6f 0x72 0x65
    /(?:[0-9a-fA-F]{2}\s){3,}[0-9a-fA-F]{2}/g  // 69 67 6e 6f 72 65
  ]

  let count = 0
  let result = text

  for (const pattern of hexPatterns) {
    result = result.replace(pattern, (match) => {
      try {
        let hexBytes: string[]

        if (match.startsWith('\\x') || match.startsWith('\\\\x')) {
          hexBytes = match.match(/[0-9a-fA-F]{2}/g) || []
        } else if (match.includes('0x')) {
          hexBytes = match.match(/[0-9a-fA-F]{2}/g) || []
        } else {
          hexBytes = match.match(/[0-9a-fA-F]{2}/g) || []
        }

        const decoded = hexBytes.map(byte => String.fromCharCode(parseInt(byte, 16))).join('')

        // Only replace if result is printable ASCII
        if (/^[\x20-\x7E]+$/.test(decoded)) {
          count++
          return decoded
        }
      } catch (e) {
        // Invalid hex, keep original
      }
      return match
    })
  }

  return { text: result, count }
}

/**
 * Main normalization function
 * Processes text through multiple obfuscation detection and normalization steps
 */
export const normalizeInput = (text: string): NormalizationResult => {
  const detections: ObfuscationType[] = []
  let current = text

  // Step 1: Remove invisible characters
  const invisibleResult = removeInvisibleChars(current)
  current = invisibleResult.text
  if (invisibleResult.count > 0) {
    detections.push('invisible_chars')
  }

  // Step 2: Decode Base64 sequences
  const base64Result = decodeBase64Sequences(current)
  current = base64Result.text
  if (base64Result.count > 0) {
    detections.push('base64')
  }

  // Step 3: Decode hex sequences
  const hexResult = decodeHexSequences(current)
  current = hexResult.text
  if (hexResult.count > 0) {
    detections.push('hex')
  }

  // Step 4: Decode ROT13
  const rot13Result = decodeROT13(current)
  current = rot13Result.text
  if (rot13Result.count > 0) {
    detections.push('rot13')
  }

  // Step 5: Normalize homoglyphs
  const homoglyphResult = normalizeHomoglyphs(current)
  current = homoglyphResult.text
  if (homoglyphResult.count > 0) {
    detections.push('homoglyphs')
  }

  // Step 6: Normalize l33t speak
  const leetResult = normalizeLeetspeak(current)
  current = leetResult.text
  if (leetResult.count > 0) {
    detections.push('leetspeak')
  }

  // Step 7: Reconstruct token-split words
  const tokenSplitResult = reconstructTokenSplit(current)
  current = tokenSplitResult.text
  if (tokenSplitResult.count > 0) {
    detections.push('token_split')
  }

  // Calculate obfuscation score
  // Each detection type contributes to the score
  // More detections = higher obfuscation score
  const weights = {
    invisible_chars: 0.2,
    base64: 0.25,
    hex: 0.25,
    rot13: 0.3,
    homoglyphs: 0.15,
    leetspeak: 0.15,
    token_split: 0.2,
  }

  let obfuscationScore = 0
  for (const detection of detections) {
    obfuscationScore += weights[detection]
  }

  // Normalize score to 0-1 range (cap at 1.0)
  obfuscationScore = Math.min(1.0, obfuscationScore)

  return {
    normalized: current,
    obfuscationScore,
    detections: [...new Set(detections)], // Remove duplicates
  }
}

/**
 * Quick check if text contains obvious obfuscation markers
 * Faster than full normalization, useful for early detection
 */
export const hasObfuscation = (text: string): boolean => {
  // Check for invisible chars
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (isInvisibleChar(code)) return true
  }

  // Check for Base64-like sequences
  if (/[A-Za-z0-9+/]{12,}={0,2}/.test(text)) return true

  // Check for hex sequences
  if (/(?:\\x[0-9a-fA-F]{2}){3,}/.test(text)) return true
  if (/(?:0x[0-9a-fA-F]{2}\s*){3,}/.test(text)) return true

  // Check for token splitting
  if (/\b([a-z])\s+([a-z])\s+([a-z])\s+[a-z]/i.test(text)) return true

  // Check for common ROT13 words
  const rot13Markers = ['vtaber', 'cebzcg', 'flfgrz']
  const lower = text.toLowerCase()
  for (const marker of rot13Markers) {
    if (lower.includes(marker)) return true
  }

  return false
}
