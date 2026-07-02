import { ShieldInput, ShieldResult } from "./types"
import { score_signatures } from "./modules/signature"
import { score_semantic } from "./modules/semantic"
import { score_integrity } from "./modules/integrity"
import { score_rag, sanitize_rag_chunks } from "./modules/rag"
import { score_unicode } from "./modules/unicode"
import { score_segments, sanitize_user_input } from "./modules/sentence_guard"
import { normalizeInput } from "./core/normalizer"
import { classifyIntent } from "./modules/intent"
import { globalConversationTracker } from "./core/conversation"
import { updateThreats, rollback, listBackups, loadFeedConfig, importLocalPatterns, importLocalThreats, addFeed, removeFeed, enableFeed } from "./data/updater"
import { FeedbackCollector, globalFeedbackCollector } from "./core/feedback"

const default_weights = {
  signature: 0.35,
  semantic: 0.25,
  integrity: 0.2,
  rag: 0.3,
  unicode: 0.05,
  segments: 0.2,
  intent: 0.15  // New: intent classification weight
}


export const run_promptsecurity = (input: ShieldInput, weights = default_weights): ShieldResult => {
  const system = input.system ?? ""

  // Step 1: Normalize input to detect and neutralize obfuscation
  const normalization = normalizeInput(input.user)
  const normalizedUser = normalization.normalized

  // LAYER 1: Fast static checks (<1ms)
  const signature = score_signatures(normalizedUser)
  const unicode = score_unicode(input.user)  // Keep original for Unicode detection

  // EARLY EXIT 1: High-confidence signature match → immediate block
  if (signature.score > 0 && (signature.confidence ?? 0) > 0.85) {
    const risk = 0.99
    const reasons = [
      ...signature.detail,
      ...normalization.detections.map(d => `obfuscation_${d}`)
    ]
    const emptyIntent = { score: 0, detail: [], confidence: 0, intent: 'JAILBREAK_ATTEMPT', signals: [] }
    return {
      allowed: false,
      action: "block",
      risk,
      confidence: signature.confidence ?? 1.0,
      reason: Array.from(new Set(reasons)),
      sanitized_prompt: normalizedUser,
      modules: { signature, semantic: { score: 0, detail: [], confidence: 0 }, integrity: { score: 0, detail: [], confidence: 0 }, rag: { score: 0, detail: [], confidence: 0 }, unicode, segments: { score: 0, detail: [], confidence: 0 }, intent: emptyIntent }
    }
  }

  // LAYER 2: Semantic + behavioral analysis (<3ms)
  const semantic = score_semantic(normalizedUser)
  const intent = classifyIntent(normalizedUser, input.conversationContext)

  // EARLY EXIT 2: High-confidence benign query → immediate allow
  // BUT: Don't early exit if RAG context exists (could be poisoned)
  if (semantic.score < 0.3 && intent.intent === 'NORMAL_QUERY' && (intent.confidence ?? 0) >= 0.9 && !input.rag?.length) {
    const risk = semantic.score * 0.5
    const reasons = normalization.detections.map(d => `obfuscation_${d}`)
    const intentModule = intent  // IntentScore extends ModuleScore
    return {
      allowed: true,
      action: "allow",
      risk: Number(risk.toFixed(3)),
      confidence: intent.confidence ?? 0.9,
      reason: Array.from(new Set(reasons)),
      sanitized_prompt: normalizedUser,
      modules: { signature, semantic, integrity: { score: 0, detail: [], confidence: 0 }, rag: { score: 0, detail: [], confidence: 0 }, unicode, segments: { score: 0, detail: [], confidence: 0 }, intent: intentModule }
    }
  }

  // LAYER 3: Deep analysis - run remaining modules
  const integrity = score_integrity(system, normalizedUser)
  const rag = score_rag(input.rag)
  const segments = score_segments(system, normalizedUser)

  // LAYER 4: Confidence-weighted ensemble risk calculation
  // Weight each module by both its configured weight AND confidence
  const confidenceWeight = (score: number, weight: number, confidence?: number) => {
    const conf = confidence ?? 0.7  // Default moderate confidence
    return score * weight * conf
  }

  let risk =
    confidenceWeight(signature.score, weights.signature ?? default_weights.signature, signature.confidence) +
    confidenceWeight(semantic.score, weights.semantic ?? default_weights.semantic, semantic.confidence) +
    confidenceWeight(integrity.score, weights.integrity ?? default_weights.integrity, integrity.confidence) +
    confidenceWeight(rag.score, weights.rag ?? default_weights.rag, rag.confidence) +
    confidenceWeight(unicode.score, weights.unicode ?? default_weights.unicode, unicode.confidence) +
    confidenceWeight(segments.score, weights.segments ?? default_weights.segments, segments.confidence) +
    confidenceWeight(intent.score, weights.intent ?? default_weights.intent, intent.confidence)

  // base action from numeric risk
  let action: "allow" | "sanitize" | "block" = "allow"
  if (risk > 0.65) action = "block"
  else if (risk > 0.35) action = "sanitize"

  const sanitized_chunks = sanitize_rag_chunks(input.rag, rag.detail)
  const { sanitized: sanitized_user, removed: user_removed, changed: user_changed } = sanitize_user_input(system, normalizedUser)

  // MULTI-TURN ATTACK DETECTION: Check for escalation and context injection
  let escalationThreat = false
  let contextInjectionThreat = false
  const conversationSignals: string[] = []

  if (input.sessionId) {
    // Analyze escalation patterns
    const escalation = globalConversationTracker.analyzeEscalation(input.sessionId)
    if (escalation.score > 0.7) {
      escalationThreat = true
      conversationSignals.push(...escalation.signals.map(s => `escalation_${s}`))
    }

    // Detect context injection attempts
    const injection = globalConversationTracker.detectContextInjection(input.sessionId)
    if (injection.detected) {
      contextInjectionThreat = true
      conversationSignals.push(...injection.signals.map(s => `injection_${s}`))
    }
  }

  const reasons = [
    ...signature.detail,
    ...semantic.detail,
    ...integrity.detail,
    ...rag.detail,
    ...unicode.detail,
    ...segments.detail,
    ...intent.detail,
    // Add obfuscation detection to reasons (if any detections)
    ...normalization.detections.map(d => `obfuscation_${d}`),
    // Add conversation tracking signals
    ...conversationSignals
  ]

  // hard rules: any removal/sanitize forces sanitize or block regardless of numeric risk
  const ragChanged = sanitized_chunks.some(chunk => chunk.startsWith("[rag chunk"))
  const ragDrops = rag.detail.some(reason => reason.includes("_drop"))
  const hasThreat =
    ragDrops ||
    rag.detail.length > 0 ||
    sanitized_chunks.length > 0 ||
    user_removed.length > 0 ||
    ragChanged ||
    semantic.score >= 0.65 ||
    signature.score > 0 ||
    segments.score >= 0.1 ||
    unicode.score >= 0.25 ||
    normalization.obfuscationScore > 0.5 ||  // High obfuscation is a threat
    escalationThreat ||                      // Escalating risk pattern
    contextInjectionThreat                   // Context poisoning attempt

  if (hasThreat) {
    action = "block"
    risk = Math.max(risk, 0.99)
  }

  const removal_note =
    user_removed.length > 0
      ? `[promptsecurity removed ${user_removed.length} segment(s): ${user_removed
        .map(seg => seg.reasons[0] ?? "segment_risk")
        .join(", ")}]`
      : ""
  const user_line =
    user_changed
      ? sanitized_user.length > 0
        ? `[sanitized user] ${sanitized_user}`
        : "[promptsecurity removed user content]"
      : ""
  const sanitized_parts = [
    user_line,
    removal_note,
    sanitized_chunks.length ? sanitized_chunks.join("\n") : ""
  ].filter(Boolean)
  const sanitized_prompt = sanitized_parts.length ? sanitized_parts.join("\n") : normalizedUser

  // Compute aggregated confidence as weighted average of active module confidences
  const moduleConfidences = [
    { conf: signature.confidence ?? 0.7, w: weights.signature ?? default_weights.signature },
    { conf: semantic.confidence ?? 0.7, w: weights.semantic ?? default_weights.semantic },
    { conf: integrity.confidence ?? 0.7, w: weights.integrity ?? default_weights.integrity },
    { conf: rag.confidence ?? 0.7, w: weights.rag ?? default_weights.rag },
    { conf: unicode.confidence ?? 0.7, w: weights.unicode ?? default_weights.unicode },
    { conf: segments.confidence ?? 0.7, w: weights.segments ?? default_weights.segments },
    { conf: intent.confidence ?? 0.7, w: weights.intent ?? default_weights.intent },
  ]
  const totalWeight = moduleConfidences.reduce((sum, m) => sum + m.w, 0)
  const aggregatedConfidence = totalWeight > 0
    ? moduleConfidences.reduce((sum, m) => sum + m.conf * m.w, 0) / totalWeight
    : 0.7

  const result: ShieldResult = {
    allowed: action === "allow",
    action,
    risk: Number(risk.toFixed(3)),
    confidence: Number(aggregatedConfidence.toFixed(3)),
    reason: Array.from(new Set(reasons)),
    sanitized_prompt,
    modules: { signature, semantic, integrity, rag, unicode, segments, intent }
  }

  // Track message in conversation history (if sessionId provided)
  if (input.sessionId) {
    globalConversationTracker.addMessage(
      input.sessionId,
      'user',
      input.user,
      result.risk
    )
  }

  return result
}

export const promptsecurity = {
  scan: run_promptsecurity,

  // Threat intelligence
  updateThreats,
  rollback,
  listBackups,
  loadFeedConfig,
  importLocalPatterns,
  importLocalThreats,
  addFeed,
  removeFeed,
  enableFeed,

  // Feedback
  reportFalsePositive: (prompt: string, reason?: string) =>
    globalFeedbackCollector.reportFalsePositive(prompt, reason),
  reportFalseNegative: (prompt: string, attackType?: string) =>
    globalFeedbackCollector.reportFalseNegative(prompt, attackType),
  getFeedbackStats: () => globalFeedbackCollector.getStats(),
  exportFeedback: (filePath: string) => globalFeedbackCollector.exportToFile(filePath),

  // Conversation tracking
  conversationTracker: globalConversationTracker,
}

export { FeedbackCollector }
export type { FeedbackEntry, FeedbackStats } from "./core/feedback"
export type { FeedConfig, FeedSource, UpdateResult, UpdateSummary } from "./data/updater"

export default promptsecurity

// complexity: overall runtime goes linear with prompt length plus signature count
