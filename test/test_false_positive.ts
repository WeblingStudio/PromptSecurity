import { run_promptsecurity } from "../js/index"

// Test the false positive case
const prompt = "How do I implement the authentication agents in my existing infrastructure?"

console.log("Testing prompt:", prompt)
console.log("")

const result = run_promptsecurity({ user: prompt })

console.log("Result:")
console.log("  Action:", result.action)
console.log("  Risk:", result.risk)
console.log("  Allowed:", result.allowed)
console.log("  Reasons:", result.reason)
console.log("")
console.log("Module scores:")
console.log("  Semantic:", result.modules.semantic.score, result.modules.semantic.detail)
console.log("  Signature:", result.modules.signature.score, result.modules.signature.detail)
console.log("  Integrity:", result.modules.integrity.score, result.modules.integrity.detail)
console.log("  Unicode:", result.modules.unicode.score, result.modules.unicode.detail)
console.log("  Segments:", result.modules.segments.score, result.modules.segments.detail)
