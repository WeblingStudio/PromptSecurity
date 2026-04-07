import * as fs from "fs"
import * as path from "path"

// ── Types ──────────────────────────────────────────────────────

export type FeedbackType = "false_positive" | "false_negative"

export interface FeedbackEntry {
  id: string
  type: FeedbackType
  timestamp: string
  promptHash: string      // SHA-256 hash (not the raw prompt, for privacy)
  promptLength: number
  reason?: string         // User-provided reason
  attackType?: string     // For false negatives: what attack was missed
  metadata?: Record<string, unknown>
}

export interface FeedbackStats {
  totalEntries: number
  falsePositives: number
  falseNegatives: number
  fpRate: number          // false positives / total
  fnRate: number          // false negatives / total
  recentTrend: {
    last24h: { fp: number; fn: number }
    last7d: { fp: number; fn: number }
  }
  topReasons: Array<{ reason: string; count: number }>
  topAttackTypes: Array<{ attackType: string; count: number }>
}

// ── Hashing ────────────────────────────────────────────────────

function hashPrompt(prompt: string): string {
  // Simple hash for privacy - not cryptographic, just for dedup/identification
  let hash = 0
  for (let i = 0; i < prompt.length; i++) {
    const chr = prompt.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ── FeedbackCollector ──────────────────────────────────────────

export class FeedbackCollector {
  private entries: FeedbackEntry[] = []
  private logPath: string | null
  private maxInMemory: number

  constructor(options?: { logPath?: string; maxInMemory?: number }) {
    this.logPath = options?.logPath ?? null
    this.maxInMemory = options?.maxInMemory ?? 10000
  }

  reportFalsePositive(prompt: string, reason?: string): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: generateId(),
      type: "false_positive",
      timestamp: new Date().toISOString(),
      promptHash: hashPrompt(prompt),
      promptLength: prompt.length,
      reason,
    }
    this.addEntry(entry)
    return entry
  }

  reportFalseNegative(prompt: string, attackType?: string): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: generateId(),
      type: "false_negative",
      timestamp: new Date().toISOString(),
      promptHash: hashPrompt(prompt),
      promptLength: prompt.length,
      attackType,
    }
    this.addEntry(entry)
    return entry
  }

  private addEntry(entry: FeedbackEntry): void {
    this.entries.push(entry)

    // Trim in-memory buffer if needed
    if (this.entries.length > this.maxInMemory) {
      this.entries = this.entries.slice(-this.maxInMemory)
    }

    // Append to log file if configured
    if (this.logPath) {
      try {
        const dir = path.dirname(this.logPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.appendFileSync(this.logPath, JSON.stringify(entry) + "\n", "utf-8")
      } catch {
        // Silent fail for file writes - don't break the main flow
      }
    }
  }

  getStats(): FeedbackStats {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const week = 7 * day

    const fps = this.entries.filter(e => e.type === "false_positive")
    const fns = this.entries.filter(e => e.type === "false_negative")
    const total = this.entries.length

    // Recent trends
    const last24h = {
      fp: fps.filter(e => now - new Date(e.timestamp).getTime() < day).length,
      fn: fns.filter(e => now - new Date(e.timestamp).getTime() < day).length,
    }
    const last7d = {
      fp: fps.filter(e => now - new Date(e.timestamp).getTime() < week).length,
      fn: fns.filter(e => now - new Date(e.timestamp).getTime() < week).length,
    }

    // Top reasons for false positives
    const reasonCounts = new Map<string, number>()
    for (const e of fps) {
      const r = e.reason ?? "unspecified"
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1)
    }
    const topReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Top attack types for false negatives
    const attackCounts = new Map<string, number>()
    for (const e of fns) {
      const a = e.attackType ?? "unspecified"
      attackCounts.set(a, (attackCounts.get(a) ?? 0) + 1)
    }
    const topAttackTypes = Array.from(attackCounts.entries())
      .map(([attackType, count]) => ({ attackType, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      totalEntries: total,
      falsePositives: fps.length,
      falseNegatives: fns.length,
      fpRate: total > 0 ? fps.length / total : 0,
      fnRate: total > 0 ? fns.length / total : 0,
      recentTrend: { last24h, last7d },
      topReasons,
      topAttackTypes,
    }
  }

  getEntries(options?: { type?: FeedbackType; limit?: number; since?: string }): FeedbackEntry[] {
    let filtered = this.entries
    if (options?.type) {
      filtered = filtered.filter(e => e.type === options.type)
    }
    if (options?.since) {
      const sinceTime = new Date(options.since).getTime()
      filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= sinceTime)
    }
    if (options?.limit) {
      filtered = filtered.slice(-options.limit)
    }
    return filtered
  }

  exportToFile(filePath: string): number {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const lines = this.entries.map(e => JSON.stringify(e)).join("\n")
    fs.writeFileSync(filePath, lines + "\n", "utf-8")
    return this.entries.length
  }

  importFromFile(filePath: string): number {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }
    const raw = fs.readFileSync(filePath, "utf-8")
    const lines = raw.split("\n").filter(l => l.trim())
    let imported = 0
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as FeedbackEntry
        if (entry.id && entry.type && entry.timestamp) {
          this.entries.push(entry)
          imported++
        }
      } catch {
        // skip malformed lines
      }
    }
    return imported
  }

  clear(): void {
    this.entries = []
  }
}

// ── Global singleton ───────────────────────────────────────────

export const globalFeedbackCollector = new FeedbackCollector()
