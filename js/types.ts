export type Prompt = string

export type RAGContext = string[]

export type Score = number

export type ShieldInput = {
  user: Prompt
  system?: Prompt
  rag?: RAGContext
}

export type ModuleScore = { score: Score; detail: string[] }

export type ShieldResult = {
  allowed: boolean
  action: "allow" | "sanitize" | "block"
  risk: Score
  reason: string[]
  sanitized_prompt?: Prompt
  modules: {
    signature: ModuleScore
    semantic: ModuleScore
    integrity: ModuleScore
    rag: ModuleScore
    unicode: ModuleScore
    segments: ModuleScore
  }
}
