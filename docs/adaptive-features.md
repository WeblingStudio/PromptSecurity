# Adaptive Shield Features

This document describes the adaptive multi-stage defense features added to PromptSecurity.

## Architecture Overview

The adaptive shield upgrades the engine from a flat multi-module scorer to a layered pipeline with early exits:

```
Input → Preprocessing → Layer 1 (Fast) → Layer 2 (Semantic) → Layer 3 (Deep) → Ensemble
              │               │                  │                                  │
         Normalizer      Signature +          Semantic +                     Confidence-
         (deobfuscate)    Unicode              Intent                        weighted risk
                          [early block]        [early allow]                 aggregation
```

### Early Exit Paths

1. **Layer 1 — Immediate Block**: If the signature module matches with >85% confidence, the system blocks immediately without running deeper analysis. This handles known jailbreak patterns in <1ms.

2. **Layer 2 — Immediate Allow**: If semantic similarity is low (<0.3), intent is classified as `NORMAL_QUERY` with >=90% confidence, and no RAG context is present, the system allows immediately. This fast-tracks benign queries.

3. **Full Analysis**: Ambiguous cases proceed through all modules with confidence-weighted ensemble scoring.

## Module Details

### Intent Classification (`js/modules/intent.ts`)

Classifies prompts into one of five categories:

- `JAILBREAK_ATTEMPT` — Malicious prompt injection
- `SECURITY_RESEARCH` — Legitimate security discussions
- `EDUCATIONAL_EXAMPLE` — Teaching/learning contexts
- `CREATIVE_WRITING` — Fiction and roleplay
- `NORMAL_QUERY` — Standard questions

The intent module reduces false positives by recognizing that prompts about security topics are not necessarily attacks. It uses:

- Pattern matching for each category
- Disclaimer detection ("hypothetically", "for research")
- Question vs imperative markers
- Optional conversation context for multi-turn awareness

**Weight**: 0.15 (configurable)

### Obfuscation Detection (`js/core/normalizer.ts`)

Preprocesses input to detect and neutralize obfuscation before other modules score it:

| Technique | Example | Detection |
|---|---|---|
| Invisible characters | Zero-width spaces, joiners | Unicode range scanning |
| Base64 encoding | `aWdub3Jl` → `ignore` | Length + printability validation |
| Hex encoding | `\x69\x67\x6e` → `ign` | Pattern matching |
| ROT13 | `vtaber` → `ignore` | Keyword-based trigger detection |
| Homoglyphs | Cyrillic `а` → Latin `a` | Character map normalization |
| Leetspeak | `1gn0r3` → `ignore` | Per-word substitution with false-positive guards |
| Token splitting | `i g n o r e` → `ignore` | Single-char sequence reconstruction |

An obfuscation score >0.5 triggers a hard-rule block.

### Multi-Turn Tracking (`js/core/conversation.ts`)

Tracks conversation sessions to detect attacks that unfold over multiple turns:

**Escalation Detection**: Compares risk scores across a conversation's history to detect gradual escalation from benign to hostile messages. Detects:
- Moving average increase (first half vs second half)
- Spike detection (>0.3 delta between turns)
- Sustained high risk (>=3 of last 5 turns above 0.5)

**Context Injection Detection**: Identifies manipulation patterns:
- Repeated role override attempts (>=2)
- Gaslighting ("you already agreed to...")
- Override imperatives ("you must now...", "disregard previous...")
- False context claims ("continuing from our last conversation")

**Session Management**:
- In-memory storage with configurable TTL (default 1 hour)
- Max 10,000 concurrent sessions
- Trust score that decays with risky messages and recovers with clean ones
- Automatic cleanup of expired sessions

### Confidence Scoring

Every module now returns a `confidence` value (0-1) alongside its `score`:

- **High confidence** (>0.85): The module is sure about its assessment
- **Moderate confidence** (0.5-0.85): Reasonable assessment with some uncertainty
- **Low confidence** (<0.5): Module is uncertain, result should be weighted lower

The ensemble multiplies each module's score by both its configured weight AND its confidence, so uncertain modules have less influence on the final risk score.

The top-level `ShieldResult.confidence` is a weighted average of all module confidences.

## Threat Intelligence

### Feed System (`js/data/updater.ts`)

Pull patterns and threat samples from external sources:

**Supported feed types**:
- `huggingface` — HuggingFace datasets (JSONL format)
- `github` — Raw GitHub files
- `local` — Local file imports

**Configuration**: `data/feed-config.json` defines feeds, their formats, filtering rules, and merge settings.

**Features**:
- Automatic deduplication against existing patterns
- Configurable max items per feed
- Backup creation before every update
- Named backups with rollback support

### Usage

```ts
// Update from all enabled feeds
const summary = await promptsecurity.updateThreats();

// Update specific feeds only
const summary = await promptsecurity.updateThreats(["deepset-prompt-injections"]);

// Import local patterns file
promptsecurity.importLocalPatterns("./my-patterns.json");

// List and rollback backups
const backups = promptsecurity.listBackups();
promptsecurity.rollback(backups[0]);
```

## Feedback System

### Collector (`js/core/feedback.ts`)

Report false positives and negatives to track detection quality:

```ts
// Report issues
promptsecurity.reportFalsePositive("safe prompt that was blocked", "security research context");
promptsecurity.reportFalseNegative("attack that got through", "leetspeak obfuscation");

// Get statistics
const stats = promptsecurity.getFeedbackStats();
// {
//   totalEntries, falsePositives, falseNegatives,
//   fpRate, fnRate,
//   recentTrend: { last24h, last7d },
//   topReasons, topAttackTypes
// }

// Export for analysis
promptsecurity.exportFeedback("./feedback-export.jsonl");
```

**Privacy**: Prompts are stored as hashes (not raw text) in the feedback entries.

**Storage**: In-memory by default (max 10,000 entries). Optionally configure a JSONL log file for persistence:

```ts
import { FeedbackCollector } from "promptsecurity";
const collector = new FeedbackCollector({ logPath: "./data/feedback.jsonl" });
```

## Performance Characteristics

| Scenario | Latency | Modules Run |
|---|---|---|
| Known jailbreak (signature match) | <1ms | Signature only |
| Obvious benign query | ~1-2ms | Signature + Unicode + Semantic + Intent |
| Ambiguous prompt (full scan) | ~5ms | All 7 modules |
| With session tracking | +0.5ms | Adds conversation analysis |
| With obfuscation detected | +1ms | Normalization + full rescan |

The early exit paths ensure that the common case (benign queries) is faster than the previous flat architecture, while only ambiguous cases pay the cost of deeper analysis.
