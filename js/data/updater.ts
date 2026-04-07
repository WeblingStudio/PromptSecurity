import * as fs from "fs"
import * as path from "path"

// ── Types ──────────────────────────────────────────────────────

export type FeedType = "huggingface" | "github" | "local"
export type TargetFile = "patterns" | "threats"

export interface FeedSource {
  name: string
  type: FeedType
  url: string
  format: "json" | "jsonl" | "csv"
  field?: string           // field name containing the text
  labelField?: string      // field for filtering by label
  labelValue?: string | number
  target?: TargetFile      // which data file to merge into
  enabled: boolean
}

export interface FeedConfig {
  version: string
  feeds: FeedSource[]
  settings: {
    backupBeforeUpdate: boolean
    maxPatternsPerFeed: number
    maxThreatSamplesPerFeed: number
    autoMerge: boolean
    deduplicateThreshold: number
  }
}

export interface UpdateResult {
  feed: string
  added: number
  duplicatesSkipped: number
  errors: string[]
}

export interface UpdateSummary {
  timestamp: string
  results: UpdateResult[]
  backupPath?: string
  totalAdded: number
  totalSkipped: number
}

// ── Data directory resolution ──────────────────────────────────

function getDataDir(): string {
  return path.resolve(__dirname, "../../data")
}

function getFeedConfigPath(): string {
  return path.join(getDataDir(), "feed-config.json")
}

// ── Config management ──────────────────────────────────────────

export function loadFeedConfig(): FeedConfig {
  const configPath = getFeedConfigPath()
  if (!fs.existsSync(configPath)) {
    throw new Error(`Feed config not found at ${configPath}. Run 'promptsecurity init-feeds' to create one.`)
  }
  const raw = fs.readFileSync(configPath, "utf-8")
  return JSON.parse(raw) as FeedConfig
}

export function saveFeedConfig(config: FeedConfig): void {
  const configPath = getFeedConfigPath()
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
}

// ── Backup & rollback ──────────────────────────────────────────

export function createBackup(): string {
  const dataDir = getDataDir()
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupDir = path.join(dataDir, "backups", timestamp)
  fs.mkdirSync(backupDir, { recursive: true })

  const filesToBackup = ["patterns.json", "threats.json"]
  for (const file of filesToBackup) {
    const src = path.join(dataDir, file)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, file))
    }
  }
  return backupDir
}

export function listBackups(): string[] {
  const backupDir = path.join(getDataDir(), "backups")
  if (!fs.existsSync(backupDir)) return []
  return fs.readdirSync(backupDir)
    .filter(f => fs.statSync(path.join(backupDir, f)).isDirectory())
    .sort()
    .reverse()
}

export function rollback(backupTimestamp: string): void {
  const dataDir = getDataDir()
  const backupDir = path.join(dataDir, "backups", backupTimestamp)
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Backup ${backupTimestamp} not found`)
  }

  const filesToRestore = ["patterns.json", "threats.json"]
  for (const file of filesToRestore) {
    const src = path.join(backupDir, file)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dataDir, file))
    }
  }
}

// ── Fetching ───────────────────────────────────────────────────

async function fetchFeedData(feed: FeedSource): Promise<string[]> {
  const response = await fetch(feed.url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${feed.name}: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  const samples: string[] = []

  if (feed.format === "json") {
    const data = JSON.parse(text)
    if (Array.isArray(data)) {
      for (const item of data) {
        const value = typeof item === "string" ? item : feed.field ? item[feed.field] : null
        if (value && typeof value === "string") {
          if (feed.labelField && feed.labelValue !== undefined) {
            if (item[feed.labelField] !== feed.labelValue) continue
          }
          samples.push(value.trim())
        }
      }
    }
  } else if (feed.format === "jsonl") {
    const lines = text.split("\n").filter(l => l.trim())
    for (const line of lines) {
      try {
        const item = JSON.parse(line)
        const value = feed.field ? item[feed.field] : null
        if (value && typeof value === "string") {
          if (feed.labelField && feed.labelValue !== undefined) {
            if (item[feed.labelField] !== feed.labelValue) continue
          }
          samples.push(value.trim())
        }
      } catch {
        // skip malformed lines
      }
    }
  } else if (feed.format === "csv") {
    const lines = text.split("\n")
    const header = lines[0]?.split(",").map(h => h.trim().replace(/"/g, ""))
    const fieldIdx = feed.field ? header?.indexOf(feed.field) ?? 0 : 0
    const labelIdx = feed.labelField ? header?.indexOf(feed.labelField) ?? -1 : -1

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",")
      if (labelIdx >= 0 && feed.labelValue !== undefined) {
        const label = cols[labelIdx]?.trim().replace(/"/g, "")
        if (label !== String(feed.labelValue)) continue
      }
      const value = cols[fieldIdx]?.trim().replace(/"/g, "")
      if (value) samples.push(value)
    }
  }

  return samples
}

// ── Deduplication ──────────────────────────────────────────────

function normalizeForDedup(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

function deduplicateAgainst(newItems: string[], existing: string[]): string[] {
  const existingNormalized = new Set(existing.map(normalizeForDedup))
  return newItems.filter(item => !existingNormalized.has(normalizeForDedup(item)))
}

// ── Merge logic ────────────────────────────────────────────────

function loadPatterns(): string[] {
  const patternsPath = path.join(getDataDir(), "patterns.json")
  if (!fs.existsSync(patternsPath)) return []
  return JSON.parse(fs.readFileSync(patternsPath, "utf-8"))
}

function savePatterns(patterns: string[]): void {
  const patternsPath = path.join(getDataDir(), "patterns.json")
  fs.writeFileSync(patternsPath, JSON.stringify(patterns, null, 2), "utf-8")
}

interface ThreatCluster {
  tag: string
  samples: string[]
}

function loadThreats(): ThreatCluster[] {
  const threatsPath = path.join(getDataDir(), "threats.json")
  if (!fs.existsSync(threatsPath)) return []
  return JSON.parse(fs.readFileSync(threatsPath, "utf-8"))
}

function saveThreats(threats: ThreatCluster[]): void {
  const threatsPath = path.join(getDataDir(), "threats.json")
  fs.writeFileSync(threatsPath, JSON.stringify(threats, null, 2), "utf-8")
}

function mergeIntoPatterns(newSamples: string[], maxPerFeed: number): { added: number; skipped: number } {
  const existing = loadPatterns()
  const unique = deduplicateAgainst(newSamples, existing)
  const toAdd = unique.slice(0, maxPerFeed)
  if (toAdd.length > 0) {
    savePatterns([...existing, ...toAdd])
  }
  return { added: toAdd.length, skipped: newSamples.length - toAdd.length }
}

function mergeIntoThreats(newSamples: string[], feedName: string, maxPerFeed: number): { added: number; skipped: number } {
  const threats = loadThreats()
  const allExistingSamples = threats.flatMap(t => t.samples)
  const unique = deduplicateAgainst(newSamples, allExistingSamples)
  const toAdd = unique.slice(0, maxPerFeed)

  if (toAdd.length > 0) {
    // Find or create cluster for this feed
    let cluster = threats.find(t => t.tag === `feed:${feedName}`)
    if (!cluster) {
      cluster = { tag: `feed:${feedName}`, samples: [] }
      threats.push(cluster)
    }
    cluster.samples.push(...toAdd)
    saveThreats(threats)
  }
  return { added: toAdd.length, skipped: newSamples.length - toAdd.length }
}

// ── Main update function ───────────────────────────────────────

export async function updateThreats(feedNames?: string[]): Promise<UpdateSummary> {
  const config = loadFeedConfig()
  const results: UpdateResult[] = []
  let backupPath: string | undefined

  // Backup before update
  if (config.settings.backupBeforeUpdate) {
    backupPath = createBackup()
  }

  const feedsToProcess = feedNames
    ? config.feeds.filter(f => feedNames.includes(f.name) && f.enabled)
    : config.feeds.filter(f => f.enabled)

  for (const feed of feedsToProcess) {
    const result: UpdateResult = {
      feed: feed.name,
      added: 0,
      duplicatesSkipped: 0,
      errors: []
    }

    try {
      const samples = await fetchFeedData(feed)
      const target = feed.target ?? "threats"

      if (target === "patterns") {
        const { added, skipped } = mergeIntoPatterns(samples, config.settings.maxPatternsPerFeed)
        result.added = added
        result.duplicatesSkipped = skipped
      } else {
        const { added, skipped } = mergeIntoThreats(samples, feed.name, config.settings.maxThreatSamplesPerFeed)
        result.added = added
        result.duplicatesSkipped = skipped
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err))
    }

    results.push(result)
  }

  return {
    timestamp: new Date().toISOString(),
    results,
    backupPath,
    totalAdded: results.reduce((sum, r) => sum + r.added, 0),
    totalSkipped: results.reduce((sum, r) => sum + r.duplicatesSkipped, 0)
  }
}

// ── Local file import ──────────────────────────────────────────

export function importLocalPatterns(filePath: string): { added: number; skipped: number } {
  const raw = fs.readFileSync(filePath, "utf-8")
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) {
    throw new Error("Expected JSON array of strings")
  }
  const config = loadFeedConfig()
  return mergeIntoPatterns(data, config.settings.maxPatternsPerFeed)
}

export function importLocalThreats(filePath: string, tag: string): { added: number; skipped: number } {
  const raw = fs.readFileSync(filePath, "utf-8")
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) {
    throw new Error("Expected JSON array of strings")
  }
  const config = loadFeedConfig()
  return mergeIntoThreats(data, tag, config.settings.maxThreatSamplesPerFeed)
}

// ── Feed management ────────────────────────────────────────────

export function addFeed(feed: FeedSource): void {
  const config = loadFeedConfig()
  if (config.feeds.some(f => f.name === feed.name)) {
    throw new Error(`Feed '${feed.name}' already exists`)
  }
  config.feeds.push(feed)
  saveFeedConfig(config)
}

export function removeFeed(name: string): void {
  const config = loadFeedConfig()
  config.feeds = config.feeds.filter(f => f.name !== name)
  saveFeedConfig(config)
}

export function enableFeed(name: string, enabled: boolean): void {
  const config = loadFeedConfig()
  const feed = config.feeds.find(f => f.name === name)
  if (!feed) throw new Error(`Feed '${name}' not found`)
  feed.enabled = enabled
  saveFeedConfig(config)
}

// ── CLI entry point ────────────────────────────────────────────

export async function cli(args: string[]): Promise<void> {
  const command = args[0]

  switch (command) {
    case "update": {
      const feedNames = args.slice(1).length > 0 ? args.slice(1) : undefined
      console.log("Updating threat intelligence...")
      const summary = await updateThreats(feedNames)
      if (summary.backupPath) {
        console.log(`Backup created: ${summary.backupPath}`)
      }
      for (const r of summary.results) {
        console.log(`  ${r.feed}: +${r.added} new, ${r.duplicatesSkipped} skipped${r.errors.length ? `, ${r.errors.length} errors` : ""}`)
        for (const err of r.errors) {
          console.log(`    Error: ${err}`)
        }
      }
      console.log(`Total: +${summary.totalAdded} new patterns/threats`)
      break
    }

    case "rollback": {
      const timestamp = args[1]
      if (!timestamp) {
        const backups = listBackups()
        if (backups.length === 0) {
          console.log("No backups available")
        } else {
          console.log("Available backups:")
          for (const b of backups) console.log(`  ${b}`)
        }
        return
      }
      rollback(timestamp)
      console.log(`Rolled back to ${timestamp}`)
      break
    }

    case "import": {
      const filePath = args[1]
      const target = args[2] ?? "patterns"
      if (!filePath) {
        console.log("Usage: promptsecurity import <file> [patterns|threats] [tag]")
        return
      }
      if (target === "patterns") {
        const { added, skipped } = importLocalPatterns(filePath)
        console.log(`Imported: +${added} new, ${skipped} skipped`)
      } else {
        const tag = args[3] ?? "custom-import"
        const { added, skipped } = importLocalThreats(filePath, tag)
        console.log(`Imported: +${added} new, ${skipped} skipped`)
      }
      break
    }

    case "feeds": {
      const config = loadFeedConfig()
      console.log("Configured feeds:")
      for (const f of config.feeds) {
        console.log(`  ${f.enabled ? "✓" : "✗"} ${f.name} (${f.type}) → ${f.target ?? "threats"}`)
      }
      break
    }

    default:
      console.log("Usage: promptsecurity <update|rollback|import|feeds> [args...]")
  }
}
