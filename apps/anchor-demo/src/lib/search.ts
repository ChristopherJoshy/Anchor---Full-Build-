/** Cosine similarity for semantic search ranking (embeddings from the SDK). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0 || !Number.isFinite(dot) || !Number.isFinite(normA) || !Number.isFinite(normB)) {
    return 0;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denom) || denom === 0) return 0;
  const result = dot / denom;
  return Number.isFinite(result) ? Math.max(-1, Math.min(1, result)) : 0;
}

export interface SearchHit {
  id: number;
  score: number;
}
