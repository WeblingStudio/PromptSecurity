# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PromptSecurity is a dual-runtime (TypeScript/Python) library for detecting and sanitizing prompt injection attacks, jailbreaks, RAG poisoning, and Unicode exploits in LLM applications. The library provides deterministic, local-first security scanning with no external API dependencies.

**Published as:**
- npm: `promptsecurity`
- PyPI: `secuprompt`

**Repository:** https://github.com/WeblingStudio/PromptSecurity

## Build & Development Commands

### TypeScript/JavaScript

```bash
# Build the package (compiles to dist/)
pnpm run build
# or
npm run build

# The build uses tsconfig.build.json (NOT tsconfig.json)
# tsconfig.json is for IDE/development only
tsc -p tsconfig.build.json

# Run demo
npx tsx test/demo_sanitize.ts
```

### Python

```bash
# Install in development mode
pip install -e .

# Run demo
python test/demo_sanitize.py
```

### Publishing

The package uses `prepublishOnly` hook to automatically build before publishing. The `dist/` directory is excluded from git but included in the published npm package via the `files` field in package.json.

## Architecture

### Dual-Language Implementation

The codebase maintains parallel implementations in TypeScript and Python with identical APIs and behavior:

- **TypeScript:** `js/` directory → builds to `dist/`
- **Python:** `py/` directory → maps to `secuprompt` package name

### Core Engine Flow

Both runtimes follow the same architecture (see `js/index.ts` and `py/engine.py`):

1. **Input:** `ShieldInput` contains `user` prompt, optional `system` prompt, and optional `rag` context chunks
2. **Scoring Modules:** Each module returns a `ModuleScore` with a 0-1 score and detail strings:
   - **signature**: Pattern matching using trie-based detection of known jailbreak phrases
   - **semantic**: Embedding-based similarity vs. curated threat corpus
   - **integrity**: Modality inversion detection (imperative vs. negative polarity)
   - **rag**: Scores RAG chunks for imperatives and role hijacking attempts
   - **unicode**: Detects hidden characters, BiDi overrides, homoglyphs
   - **segments**: Sentence-level threat scoring
3. **Risk Aggregation:** Weighted sum of module scores
4. **Action Decision:**
   - `allow`: risk ≤ 0.35 and no hard rules triggered
   - `sanitize`: 0.35 < risk ≤ 0.65
   - `block`: risk > 0.65 OR hard rules triggered (signature hits, high semantic match, sentence removal)
5. **Sanitization:** If needed, constructs safe version of prompt with hostile content removed/rewritten

### Data Files

The `data/` directory contains JSON files used by detection modules:

- `patterns.json`: Known jailbreak signature strings
- `threats.json`: Semantic clusters of jailbreak samples (tags + sample prompts)
- `rag.json`: Imperative/role words for RAG context analysis
- `unicode.json`: Hidden character ranges and homoglyph blocks
- `modality.json`: Positive/negative polarity word lists for integrity checks

**Important:** These data files are:
- Imported as JSON modules in TypeScript (requires `resolveJsonModule: true`)
- Read at runtime in Python via `py/data.py` helper
- Included in published packages (npm `files` field, Python setup.py custom build)

### Module Details

Each detection module in `js/modules/` and `py/modules/` is independent and returns `ModuleScore`:

- **signature.ts/py**: Uses trie data structure for efficient pattern matching against `patterns.json`
- **semantic.ts/py**: Simple cosine similarity with embedded threat samples from `threats.json`
- **integrity.ts/py**: Detects "you must X" followed by "you must not X" contradictions
- **rag.ts/py**: Scans context chunks for imperative verbs and role override phrases
- **unicode_scan.py / unicode.ts**: Checks for invisible/ambiguous Unicode characters
- **sentence_guard.ts/py**: Segments text and scores individual sentences, removing high-risk ones

### Embedding System

`js/core/embedding.ts` and `py/core/embedding.py` provide:
- Text normalization and segmentation utilities
- Simple word-based embedding (no external models required)
- Cosine similarity computation

This is a lightweight, deterministic approach (no neural network inference).

## TypeScript Configuration

Two tsconfig files serve different purposes:

- **tsconfig.json**: Development/IDE config (loose, includes data JSON, CommonJS)
- **tsconfig.build.json**: Production build config (strict, generates declarations, ESNext modules, uses bundler resolution)

The build config must have `resolveJsonModule: true` to import `data/*.json` files.

## Python Packaging

`setup.py` uses a custom `build_py` command to copy `data/` directory into the built package as `secuprompt/data_files/`. This ensures data files are available when the package is installed from PyPI.

## Testing

Test files are in `test/`:
- `demo_sanitize.ts`: TypeScript example showing layered attacks and RAG poisoning
- `demo_sanitize.py`: Python example showing basic sanitization

There are no formal test suites currently. Demos serve as integration tests.

## Examples

`examples/` directory contains integration examples for:
- Basic allow/block flows
- Sanitization workflows
- LangChain integration (agent guards)

## Key Design Principles

1. **Deterministic**: No randomness, same input always produces same output
2. **Local-first**: No external API calls, works offline
3. **Lightweight**: ~2ms per prompt, no GPU required
4. **Explainable**: Returns detailed reasons for each detection
5. **Dual-runtime parity**: TypeScript and Python implementations must stay in sync

## Common Workflows

### Adding a new detection pattern

1. Add the pattern to the appropriate `data/*.json` file
2. Update both TypeScript and Python module implementations if logic changes
3. Test in both runtimes using the demo files
4. Rebuild and verify outputs match

### Modifying module weights

Default weights are in `js/index.ts` and `py/engine.py` (must match):
```typescript
const default_weights = {
  signature: 0.35,
  semantic: 0.25,
  integrity: 0.2,
  rag: 0.3,
  unicode: 0.05,
  segments: 0.2
}
```

Users can override these when calling `scan()`.

### Publishing updates

1. Update version in both `package.json` and `pyproject.toml`
2. For npm: `npm publish` (prepublishOnly hook runs build automatically)
3. For PyPI: `python -m build && twine upload dist/*`

## Notes

- The library is stateless; no persistence or session management
- All sanitization is done inline, no LLM calls for rewriting
- The main branch is `main` (for PRs and git operations)