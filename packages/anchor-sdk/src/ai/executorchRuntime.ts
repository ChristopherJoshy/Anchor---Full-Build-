/**
 * Shared lazy runtime for the ExecuTorch-backed AI wrappers.
 *
 * Architecture notes:
 *  - The functional module API of react-native-executorch (LLMModule /
 *    SpeechToTextModule / TextEmbeddingsModule `fromModelName`) is preferred
 *    over hooks: model instances live in module-level promise caches, so
 *    nothing loads at startup and each wrapper loads only what it needs on
 *    first call.
 *  - react-native-executorch's index installs JSI bindings at import time,
 *    so the package is imported dynamically (never at module scope) and
 *    `tsc`/jest environments without the native module stay clean.
 *  - AnchorProvider pre-warms the SAME caches, so a mounted provider and
 *    createAnchorSDK() share one loaded model per task instead of two.
 */

import type {
  LLMModule,
  SpeechToTextModule,
  TextEmbeddingsModule,
} from 'react-native-executorch';

export interface PreloadOptions {
  llm?: boolean;
  speechToText?: boolean;
  textEmbeddings?: boolean;
}

let initialized = false;

/** Wires the Expo resource fetcher once; idempotent. */
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  // Dynamic import is required: react-native-executorch installs JSI native
  // bindings at module import time, so a static import would crash every
  // environment without the native module (jest, plain Node) and would eager-
  // load at SDK import, defeating the lazy-startup guarantee.
  const [{ ExpoResourceFetcher }, executorch] = await Promise.all([
    import('react-native-executorch-expo-resource-fetcher'),
    import('react-native-executorch'),
  ]);
  executorch.initExecutorch({ resourceFetcher: ExpoResourceFetcher });
  initialized = true;
}

/** Caches a load promise, resetting it on failure so a later call can retry. */
function cached<T>(slot: { promise: Promise<T> | null }, load: () => Promise<T>): Promise<T> {
  if (slot.promise) return slot.promise;
  slot.promise = load().catch((error: unknown) => {
    slot.promise = null;
    throw error;
  });
  return slot.promise;
}

const llmSlot: { promise: Promise<LLMModule> | null } = { promise: null };
const sttSlot: { promise: Promise<SpeechToTextModule> | null } = { promise: null };
const embeddingsSlot: { promise: Promise<TextEmbeddingsModule> | null } = { promise: null };

/** Qwen3 1.7B, 8da4w-quantized (default variant of the registry accessor). */
export function loadLlm(): Promise<LLMModule> {
  return cached(llmSlot, async () => {
    await ensureInitialized();
    const executorch = await import('react-native-executorch');
    return executorch.LLMModule.fromModelName(executorch.models.llm.qwen3_1_7b());
  });
}

/** Whisper base.en (English-only, 16 kHz mono input). */
export function loadSpeechToText(): Promise<SpeechToTextModule> {
  return cached(sttSlot, async () => {
    await ensureInitialized();
    const executorch = await import('react-native-executorch');
    return executorch.SpeechToTextModule.fromModelName(
      executorch.models.speech_to_text.whisper_base_en(),
    );
  });
}

/** all-mpnet-base-v2 pooled sentence embeddings (768-d). */
export function loadTextEmbeddings(): Promise<TextEmbeddingsModule> {
  return cached(embeddingsSlot, async () => {
    await ensureInitialized();
    const executorch = await import('react-native-executorch');
    return executorch.TextEmbeddingsModule.fromModelName(
      executorch.models.text_embedding.all_mpnet_base_v2(),
    );
  });
}

/** Fire-and-forget pre-warm used by AnchorProvider; errors are rethrown at call time. */
export function preloadModels(options: PreloadOptions = {}): void {
  const { llm = true, speechToText = true, textEmbeddings = true } = options;
  if (llm) loadLlm().catch(() => undefined);
  if (speechToText) loadSpeechToText().catch(() => undefined);
  if (textEmbeddings) loadTextEmbeddings().catch(() => undefined);
}
