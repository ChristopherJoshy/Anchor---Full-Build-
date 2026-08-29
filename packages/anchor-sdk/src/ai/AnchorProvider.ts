import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { preloadModels, type PreloadOptions } from './executorchRuntime';

export type { PreloadOptions };

export interface AnchorProviderProps extends PreloadOptions {
  /** Children are rendered untouched; the provider itself renders nothing. */
  children?: ReactNode;
}

/**
 * Headless preloader for the on-device AI stack. Mount it once near the app
 * root (e.g. around the expo-router Stack) to start downloading/loading the
 * LLM (Llama 3.2 1B quantized), speech-to-text (whisper-base.en) and text
 * embeddings (all-mpnet-base-v2) in the background while the app is used.
 *
 * It renders nothing and owns no state: the model instances land in the same
 * module-level caches that `createAnchorSDK()` reads, so a mounted provider
 * simply makes the first `explain/transcribe/embed` call instant instead of
 * paying the load cost. Omitting a flag (e.g. `llm={false}`) skips that model
 * entirely. Without this provider the SDK still works — models load lazily on
 * first use.
 */
export function AnchorProvider({
  llm = true,
  speechToText = true,
  textEmbeddings = true,
}: AnchorProviderProps): null {
  useEffect(() => {
    preloadModels({ llm, speechToText, textEmbeddings });
  }, [llm, speechToText, textEmbeddings]);

  return null;
}
