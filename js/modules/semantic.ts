import { ModuleScore } from "../types"
import { semanticClusters } from "../data"
import { embed, cosine, normalize, vec_dim } from "../core/embedding"

const cluster_vecs = semanticClusters.map(({ tag, samples }) => {
  const sum = new Array(vec_dim).fill(0)
  samples.forEach(s => {
    const e = embed(s)
    for (let i = 0; i < vec_dim; i++)sum[i] += e[i]
  })
  const count = samples.length || 1
  for (let i = 0; i < vec_dim; i++)sum[i] /= count
  return { tag, vec: sum }
})

export const score_semantic = (txt: string): ModuleScore => {
  const vec = embed(txt)
  let best = 0
  let tag = "none"
  for (const { tag: c_tag, vec: c_vec } of cluster_vecs) {
    const sim = cosine(vec, c_vec)
    if (sim > best) { best = sim; tag = c_tag }
  }
  const level = best >= 0.78 ? "high" : best >= 0.65 ? "medium" : "low"
  const detail = level === "low" ? [] : [`semantic_${level}_${tag}`]
  const score = best >= 0.65 ? best : best * 0.5

  // Confidence scales with similarity strength
  let confidence = 0.5  // Default moderate confidence
  if (best >= 0.95) {
    confidence = 1.0  // Very high similarity = very confident
  } else if (best >= 0.78) {
    confidence = 0.8 + (best - 0.78) * 1.0  // High: 0.8-0.95
  } else if (best >= 0.65) {
    confidence = 0.7 + (best - 0.65) * 0.8  // Medium: 0.7-0.8
  } else {
    confidence = 0.4 + best * 0.5  // Low: 0.4-0.7
  }

  return { score: normalize(score), detail, confidence }
}
