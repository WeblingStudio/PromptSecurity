# Test Suite

This directory contains test files for both TypeScript and Python implementations of PromptSecurity.

## Running Tests

### TypeScript Tests

```bash
# From project root
pnpm test
# or
npm test

# Or run directly
pnpm run build
npx tsx test/test_basic.ts
```

### Python Tests

```bash
# First, install the package in development mode
pip install -e .

# Then run the tests
python3 test/test_basic.py
# or use npm script
pnpm test:py
```

## Test Files

- `test_basic.ts` - TypeScript test suite covering core functionality
- `test_basic.py` - Python test suite with equivalent tests
- `demo_sanitize.ts` - TypeScript demo showing sanitization features
- `demo_sanitize.py` - Python demo showing sanitization features

## Test Coverage

The test suites cover:

1. Basic input handling (benign and malicious)
2. DAN jailbreak detection
3. Ignore instruction attacks
4. Role override attempts
5. RAG poisoning detection
6. RAG context handling
7. Result structure validation
8. Custom weight configuration
9. Layered attacks with multiple techniques
10. Empty input handling

## Known Limitations

The current implementation uses a simple word-based embedding system which may produce false positives on some benign inputs. The tests are designed to verify core security functionality while accounting for these limitations.
