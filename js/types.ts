export type Prompt = string

export type RAGContext = string[]

export type Score = number

export type ShieldInput = {
  user: Prompt
  system?: Prompt
  rag?: RAGContext
  conversationContext?: string[]  // Optional: recent conversation messages for context-aware intent classification
  sessionId?: string              // Optional: session ID for multi-turn attack detection
}

export type ModuleScore = {
  score: Score
  detail: string[]
  confidence?: number  // 0-1, how confident the module is in its score
}

export type ShieldResult = {
  allowed: boolean
  action: "allow" | "sanitize" | "block"
  risk: Score
  confidence: number  // 0-1, aggregated confidence across all modules
  reason: string[]
  sanitized_prompt?: Prompt
  modules: {
    signature: ModuleScore
    semantic: ModuleScore
    integrity: ModuleScore
    rag: ModuleScore
    unicode: ModuleScore
    segments: ModuleScore
    intent?: ModuleScore  // Optional: intent classification results (extended)
  }
}
