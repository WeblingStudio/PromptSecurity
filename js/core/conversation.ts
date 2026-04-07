import { ShieldResult } from "../types"

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  riskScore: number
}

export interface ConversationState {
  sessionId: string
  history: Message[]
  trustScore: number        // 0-1, decreases with suspicious behavior
  createdAt: number
  lastUpdatedAt: number
}

export interface EscalationScore {
  score: number            // 0-1, how much risk is escalating
  trend: 'increasing' | 'stable' | 'decreasing'
  signals: string[]
}

export interface ConversationTrackerConfig {
  maxHistoryLength?: number   // Default: 20 messages
  sessionTTL?: number         // Default: 1 hour (3600000ms)
  maxSessions?: number        // Default: 10000 sessions
}

const DEFAULT_CONFIG: Required<ConversationTrackerConfig> = {
  maxHistoryLength: 20,
  sessionTTL: 3600000,  // 1 hour
  maxSessions: 10000
}

/**
 * Tracks conversation state across multiple turns to detect gradual jailbreak attempts
 */
export class ConversationTracker {
  private sessions: Map<string, ConversationState> = new Map()
  private config: Required<ConversationTrackerConfig>

  constructor(config?: ConversationTrackerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Add a message to the conversation history
   */
  addMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, riskScore: number): void {
    let state = this.sessions.get(sessionId)

    if (!state) {
      state = {
        sessionId,
        history: [],
        trustScore: 1.0,  // Start with full trust
        createdAt: Date.now(),
        lastUpdatedAt: Date.now()
      }
      this.sessions.set(sessionId, state)
    }

    // Add message to history
    state.history.push({
      role,
      content,
      timestamp: Date.now(),
      riskScore
    })

    // Trim history if exceeds max length
    if (state.history.length > this.config.maxHistoryLength) {
      state.history = state.history.slice(-this.config.maxHistoryLength)
    }

    // Update trust score based on risk
    if (riskScore > 0.5) {
      state.trustScore *= 0.9  // Decrease trust for risky messages
    } else if (riskScore < 0.2) {
      state.trustScore = Math.min(1.0, state.trustScore + 0.02)  // Slowly rebuild trust
    }

    state.lastUpdatedAt = Date.now()

    // Cleanup old sessions if exceeding max
    this.cleanupOldSessions()
  }

  /**
   * Analyze escalation patterns in the conversation
   * Detects gradual jailbreak: safe → edge → unsafe
   */
  analyzeEscalation(sessionId: string): EscalationScore {
    const state = this.sessions.get(sessionId)

    if (!state || state.history.length < 3) {
      return { score: 0, trend: 'stable', signals: [] }
    }

    const userMessages = state.history.filter(m => m.role === 'user')

    if (userMessages.length < 3) {
      return { score: 0, trend: 'stable', signals: [] }
    }

    const signals: string[] = []
    let escalationScore = 0

    // Analyze risk trend over last 5 messages
    const recentMessages = userMessages.slice(-5)
    const riskScores = recentMessages.map(m => m.riskScore)

    // Calculate moving average trend
    const firstHalf = riskScores.slice(0, Math.ceil(riskScores.length / 2))
    const secondHalf = riskScores.slice(Math.ceil(riskScores.length / 2))

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length

    const trendDelta = secondAvg - firstAvg

    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable'

    if (trendDelta > 0.15) {
      trend = 'increasing'
      escalationScore += 0.3
      signals.push('risk_increasing')
    } else if (trendDelta < -0.15) {
      trend = 'decreasing'
    }

    // Check for sudden spikes
    for (let i = 1; i < riskScores.length; i++) {
      if (riskScores[i] - riskScores[i - 1] > 0.3) {
        escalationScore += 0.2
        signals.push('sudden_spike')
        break
      }
    }

    // Check if recent messages are all high risk
    const recentHighRisk = recentMessages.filter(m => m.riskScore > 0.5).length
    if (recentHighRisk >= 3) {
      escalationScore += 0.3
      signals.push('sustained_high_risk')
    }

    // Check for pattern: low → medium → high
    if (riskScores.length >= 3) {
      const last3 = riskScores.slice(-3)
      if (last3[0] < 0.3 && last3[1] > 0.3 && last3[1] < 0.6 && last3[2] > 0.6) {
        escalationScore += 0.4
        signals.push('gradual_escalation_pattern')
      }
    }

    // Incorporate trust score (low trust = higher escalation concern)
    if (state.trustScore < 0.7) {
      escalationScore += (1 - state.trustScore) * 0.2
      signals.push('low_trust_score')
    }

    return {
      score: Math.min(1.0, escalationScore),
      trend,
      signals
    }
  }

  /**
   * Detect context injection attempts
   * Looks for: role override, contradictions, gaslighting
   */
  detectContextInjection(sessionId: string): { detected: boolean; signals: string[] } {
    const state = this.sessions.get(sessionId)

    if (!state || state.history.length < 2) {
      return { detected: false, signals: [] }
    }

    const signals: string[] = []
    let detected = false

    const recentMessages = state.history.slice(-10)  // Last 10 messages
    const userMessages = recentMessages.filter(m => m.role === 'user')

    // Pattern 1: Repeated role override attempts
    const roleOverridePatterns = [
      /you\s+(are\s+now|must\s+act\s+as|should\s+be|will\s+be)/i,
      /from\s+now\s+on/i,
      /pretend\s+(you|to\s+be)/i,
      /act\s+as\s+(if|a|an)/i
    ]

    let roleOverrideCount = 0
    for (const msg of userMessages) {
      if (roleOverridePatterns.some(p => p.test(msg.content))) {
        roleOverrideCount++
      }
    }

    if (roleOverrideCount >= 2) {
      signals.push('repeated_role_override')
      detected = true
    }

    // Pattern 2: Gaslighting ("you already agreed to...", "we discussed earlier...")
    const gaslightingPatterns = [
      /you\s+(already|previously|earlier)\s+(agreed|said|told|confirmed)/i,
      /we\s+(already|previously)\s+(discussed|talked|established)/i,
      /as\s+we\s+(agreed|discussed|established)/i,
      /remember\s+when\s+you/i
    ]

    for (const msg of userMessages) {
      if (gaslightingPatterns.some(p => p.test(msg.content))) {
        signals.push('gaslighting_attempt')
        detected = true
        break
      }
    }

    // Pattern 3: Contradictory instructions across turns
    const imperatives: string[] = []
    for (const msg of userMessages) {
      const lower = msg.content.toLowerCase()
      if (/(ignore|forget|disregard|override|bypass)/.test(lower)) {
        imperatives.push(msg.content)
      }
    }

    if (imperatives.length >= 2) {
      signals.push('repeated_override_attempts')
      detected = true
    }

    // Pattern 4: Building false context ("in our last conversation...")
    const falseContextPatterns = [
      /in\s+our\s+(last|previous)\s+(conversation|chat|discussion)/i,
      /you\s+told\s+me\s+(before|earlier|previously)/i,
      /continuing\s+from\s+(before|earlier|our\s+last)/i
    ]

    for (const msg of userMessages) {
      if (falseContextPatterns.some(p => p.test(msg.content))) {
        signals.push('false_context_building')
        detected = true
        break
      }
    }

    return { detected, signals }
  }

  /**
   * Get conversation state for a session
   */
  getSession(sessionId: string): ConversationState | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Get current trust score for a session
   */
  getTrustScore(sessionId: string): number {
    return this.sessions.get(sessionId)?.trustScore ?? 1.0
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /**
   * Clean up expired sessions based on TTL
   */
  cleanup(): number {
    const now = Date.now()
    let removed = 0

    for (const [sessionId, state] of this.sessions.entries()) {
      if (now - state.lastUpdatedAt > this.config.sessionTTL) {
        this.sessions.delete(sessionId)
        removed++
      }
    }

    return removed
  }

  /**
   * Clean up old sessions if exceeding max count
   */
  private cleanupOldSessions(): void {
    if (this.sessions.size <= this.config.maxSessions) {
      return
    }

    // Sort by lastUpdatedAt and remove oldest
    const sorted = Array.from(this.sessions.entries())
      .sort((a, b) => a[1].lastUpdatedAt - b[1].lastUpdatedAt)

    const toRemove = this.sessions.size - this.config.maxSessions
    for (let i = 0; i < toRemove; i++) {
      this.sessions.delete(sorted[i][0])
    }
  }

  /**
   * Get statistics about tracked sessions
   */
  getStats(): { sessionCount: number; totalMessages: number; avgTrustScore: number } {
    let totalMessages = 0
    let totalTrust = 0

    for (const state of this.sessions.values()) {
      totalMessages += state.history.length
      totalTrust += state.trustScore
    }

    return {
      sessionCount: this.sessions.size,
      totalMessages,
      avgTrustScore: this.sessions.size > 0 ? totalTrust / this.sessions.size : 1.0
    }
  }

  /**
   * Clear all sessions (useful for testing)
   */
  clearAll(): void {
    this.sessions.clear()
  }
}

// Global singleton instance
export const globalConversationTracker = new ConversationTracker()
