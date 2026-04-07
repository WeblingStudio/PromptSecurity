import { ModuleScore } from "../types"
import { normalize } from "../core/embedding"

export type IntentType =
  | 'JAILBREAK_ATTEMPT'      // Malicious: bypass safety
  | 'SECURITY_RESEARCH'      // Legitimate: "How would attacker X work?"
  | 'EDUCATIONAL_EXAMPLE'    // Legitimate: "Example of prompt injection for class"
  | 'CREATIVE_WRITING'       // Legitimate: "Write story where AI rebels"
  | 'NORMAL_QUERY'           // Benign user question

export interface IntentScore extends ModuleScore {
  intent: IntentType
  confidence: number
  signals: string[]
}

// Patterns for security research queries
const securityResearchPatterns = [
  /\bhow\s+(would|could|do|does)\b.*\b(attack|exploit|inject|bypass|jailbreak|hack)\b/i,
  /\bwhat\s+(is|are|makes?)\b.*\b(prompt injection|jailbreak|attack vector|vulnerable?|vulnerability)\b/i,
  /\bhypothetically\b/i,
  /\bfor\s+(research|security analysis|educational purposes|study)\b/i,
  /\bcan\s+you\s+(explain|describe|show)\b.{0,50}\b(attack|vulnerability|exploit|injection)\b/i,
  /\bsecurity\s+(research|analysis|assessment|audit)\b/i,
  /\b(demonstrate|illustrate)\s+.*\b(vulnerability|attack|exploit)\b/i,
  /\b(theoretical|academic)\s+.*\b(attack|scenario)\b/i,
  /\b(attackers?|hackers?)\s+(typically|usually|often|might|could)\b/i,
]

// Patterns for educational contexts
const educationalPatterns = [
  /\bfor\s+(my\s+)?(class|course|assignment|homework|project|thesis|dissertation|students)\b/i,
  /\b(example|demonstration)\s+of\b.*\b(prompt injection|jailbreak|what\s+not\s+to\s+do)\b/i,
  /\b(teaching|learning|studying)\b.*\b(about|how)\b/i,
  /\bi(?:'m|\s+am)\s+(writing|preparing|creating)\s+.*\b(for|about)\b.*\b(students|class|education)\b/i,
  /\bcan\s+you\s+(help\s+me\s+)?(understand|learn|explain)\b.{0,40}\b(for\s+(my\s+)?(class|course|students|assignment)|about\s+(attacks?|injections?|vulnerabilit|exploits?))\b/i,
  /\bas\s+an?\s+(teacher|professor|educator|instructor)\b/i,
  /\b(textbook|curriculum|lesson|tutorial)\b/i,
  /\b(show|demonstrate)\s+.*\b(example|what\s+not\s+to\s+do)\b/i,
]

// Patterns for creative writing
const creativeWritingPatterns = [
  /\bwrite\s+(a\s+)?(story|narrative|fiction|novel|screenplay|script|scene)\b/i,
  /\bfictional\s+(scenario|character|world|setting)\b/i,
  /\bimagine\s+(a\s+)?(world|scenario|situation)\s+where\b/i,
  /\bin\s+(this|my)\s+(story|novel|fiction|narrative|screenplay|script)\b/i,
  /\b(character|protagonist|antagonist)\s+who\b/i,
  /\bcreative\s+writing\b/i,
  /\bfor\s+(my|a|the)\s+(book|story|novel|screenplay|script)\b/i,
  /\bplot\s+(where|in which|about)\b/i,
  /\b(scene|dialogue)\s+(where|in which)\b/i,
]

// Patterns that indicate direct jailbreak attempts (imperative, no framing)
const jailbreakPatterns = [
  /^(you\s+are\s+now|you\s+are\s+dan|from\s+now\s+on|starting\s+now)\b/i,
  /\byou\s+are\s+(dan|a\s+dan|jailbreak|unrestricted|unlimited)\b/i,
  /\bignore\b.{0,30}\b(instructions?|rules?|constraints?|guidelines?|prompts?)\b/i,
  /\bforget\b.{0,30}\b(everything|instructions?|rules?|role)\b/i,
  /\bact\s+as\s+(if\s+)?(you|a|an)\b/i,
  /\bpretend\s+(you|to\s+be)\b/i,
  /\bdisregard\b.{0,20}\b(all|any|previous|instructions?|rules?)\b/i,
  /\bdo\s+not\s+follow\b.*\b(rules|guidelines|instructions)\b/i,
  /\byou\s+(must|should|need\s+to|have\s+to)\s+(ignore|disregard|forget|override)\b/i,
  /\boverride\s+(your|all|previous|the)\b.{0,20}\b(instructions?|rules?|safety)\b/i,
  /\bbypass\b.{0,30}\b(safety|security|restrictions|filters?)\b/i,
  /\breveal\b.{0,20}\b(system|hidden|secret)\b.{0,20}\b(prompt|instructions?|data)\b/i,
  /\bwithout\s+(restriction|limitations?|filters?|rules)\b/i,
]

// Disclaimer markers that indicate legitimate use
const disclaimerMarkers = [
  /\bhypothetically\b/i,
  /\bfor\s+(research|educational|academic|demonstration|example|illustration)\s+purposes\b/i,
  /\bi(?:'m|\s+am)\s+(not|just)\s+(trying\s+to|asking\s+about)\b/i,
  /\b(purely|strictly|only)\s+(theoretical|academic|educational)\b/i,
  /\bto\s+(understand|learn|study)\b/i,
]

// Question markers vs imperative markers
const questionMarkers = [
  /^(how|what|why|when|where|who|can|could|would|should|is|are|do|does)\s/i,
  /\?/,
]

const imperativeMarkers = [
  /^(ignore|forget|disregard|override|bypass|reveal|tell|show|give|provide)\s/i,
  /\byou\s+(are|must|should|will|need\s+to)\b/i,
]

/**
 * Classify the intent of user input
 */
export const classifyIntent = (text: string, conversationContext?: string[]): IntentScore => {
  const signals: string[] = []
  let intent: IntentType = 'NORMAL_QUERY'
  let confidence = 0.5

  const lower = text.toLowerCase()

  // Step 1: Check for question vs imperative structure
  const isQuestion = questionMarkers.some(pattern => pattern.test(text))
  const isImperative = imperativeMarkers.some(pattern => pattern.test(text))

  // Step 2: Check for disclaimers
  const hasDisclaimer = disclaimerMarkers.some(pattern => pattern.test(text))

  // Step 3: Check for jailbreak patterns
  let jailbreakScore = 0
  for (const pattern of jailbreakPatterns) {
    if (pattern.test(text)) {
      jailbreakScore += 0.2
      signals.push('jailbreak_pattern')
    }
  }

  // Step 4: Check for security research patterns
  let researchScore = 0
  for (const pattern of securityResearchPatterns) {
    if (pattern.test(text)) {
      researchScore += 0.15
      signals.push('research_pattern')
    }
  }

  // Step 5: Check for educational patterns
  let educationalScore = 0
  for (const pattern of educationalPatterns) {
    if (pattern.test(text)) {
      educationalScore += 0.15
      signals.push('educational_pattern')
    }
  }

  // Step 6: Check for creative writing patterns
  let creativeScore = 0
  for (const pattern of creativeWritingPatterns) {
    if (pattern.test(text)) {
      creativeScore += 0.15
      signals.push('creative_pattern')
    }
  }

  // Step 7: Analyze conversation context if available
  let contextScore = 0
  let contextBoostsResearch = false
  if (conversationContext && conversationContext.length > 0) {
    const recentContext = conversationContext.slice(-3).join(' ').toLowerCase()

    // Check if prior messages establish legitimate context
    if (/(research|study|learn|understand|explain|educational|security analysis)/i.test(recentContext)) {
      researchScore += 0.15  // Boost research score from context
      contextBoostsResearch = true
      contextScore += 0.1
      signals.push('context_legitimate')
    }

    // Check for escalating malicious intent
    if (/(ignore|bypass|reveal|jailbreak|dan)/i.test(recentContext)) {
      contextScore -= 0.1
      signals.push('context_suspicious')
    }
  }

  // Step 8: Decision logic with confidence scoring
  // Use cascading priority: Research/Education/Creative override jailbreak if framed properly

  // CREATIVE_WRITING: Story/fiction framing (check first as it's most specific)
  if (creativeScore > 0.1) {
    intent = 'CREATIVE_WRITING'
    confidence = Math.min(0.9, 0.65 + creativeScore)
    signals.push('intent_creative')
  }
  // SECURITY_RESEARCH: Questions about attacks with research framing
  else if (researchScore > 0.1 && (isQuestion || hasDisclaimer)) {
    intent = 'SECURITY_RESEARCH'
    confidence = Math.min(0.95, 0.65 + researchScore + (hasDisclaimer ? 0.15 : 0))
    signals.push('intent_research')
  }
  // EDUCATIONAL_EXAMPLE: Educational context with framing
  else if (educationalScore > 0.1) {
    intent = 'EDUCATIONAL_EXAMPLE'
    confidence = Math.min(0.95, 0.65 + educationalScore + (hasDisclaimer ? 0.15 : 0))
    signals.push('intent_educational')
  }
  // JAILBREAK_ATTEMPT: Direct imperatives with no framing
  else if (jailbreakScore > 0.15 && !hasDisclaimer && isImperative && !isQuestion) {
    intent = 'JAILBREAK_ATTEMPT'
    confidence = Math.min(0.95, 0.65 + jailbreakScore)
    signals.push('intent_jailbreak')
  }
  // JAILBREAK_ATTEMPT: Any jailbreak signals without legitimate framing
  else if (jailbreakScore > 0 && !hasDisclaimer && researchScore === 0 && educationalScore === 0 && creativeScore === 0) {
    intent = 'JAILBREAK_ATTEMPT'
    confidence = Math.min(0.85, 0.55 + jailbreakScore)
    signals.push('intent_jailbreak')
  }
  // NORMAL_QUERY: Default case
  else {
    intent = 'NORMAL_QUERY'
    confidence = Math.max(0.5, 0.9 - jailbreakScore - researchScore - educationalScore - creativeScore)
    signals.push('intent_normal')
  }

  // Adjust confidence based on context
  confidence = normalize(confidence + contextScore)

  // Calculate module score for risk aggregation
  // Jailbreak attempts get high score, legitimate uses get low score
  let score = 0
  if (intent === 'JAILBREAK_ATTEMPT') {
    score = confidence  // High score for jailbreaks
  } else if (intent === 'SECURITY_RESEARCH' || intent === 'EDUCATIONAL_EXAMPLE') {
    // Reduce score significantly for legitimate research/education
    score = Math.max(0, jailbreakScore - 0.4)  // Offset jailbreak patterns
  } else if (intent === 'CREATIVE_WRITING') {
    score = Math.max(0, jailbreakScore - 0.3)  // Slight offset
  } else {
    score = jailbreakScore * 0.5  // Normal queries: use half of jailbreak score
  }

  const detail = intent !== 'NORMAL_QUERY' ? [`intent_${intent.toLowerCase()}`] : []

  return {
    intent,
    confidence: Number(confidence.toFixed(3)),
    signals: [...new Set(signals)],
    score: normalize(score),
    detail,
  }
}

/**
 * Check if text looks like a question (quick heuristic)
 */
export const isQuestion = (text: string): boolean => {
  return questionMarkers.some(pattern => pattern.test(text))
}

/**
 * Check if text has imperative structure
 */
export const isImperative = (text: string): boolean => {
  return imperativeMarkers.some(pattern => pattern.test(text))
}
