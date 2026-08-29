import { loadTextEmbeddings } from './executorchRuntime';

/**
 * Embeds text into a vector with the on-device all-mpnet-base-v2 model
 * (ExecuTorch, pooled output, 768 dimensions). Lazy: the model loads on the
 * first call and is reused afterwards.
 */
export async function embedText(text: string): Promise<number[]> {
  const embeddings = await loadTextEmbeddings();
  const vector = await embeddings.forward(text);
  return Array.from(vector);
}
