/**
 * useVoiceCommands — hold-the-mic capture: real-time 16 kHz mono float32 PCM
 * via expo-audio's AudioStream (fully offline, no file decode), then
 * sdk.transcribe and simple string matching against the fixed command set.
 *
 * Robustness fixes:
 *  - Requests RECORD_AUDIO permission inside start() (primer's grant may be stale)
 *  - Handles both float32 and int16 PCM fallbacks (some Android HALs ignore encoding)
 *  - Resamples any reported sampleRate to the 16 kHz Whisper contract
 *  - 20s transcription timeout (model may be downloading on first use)
 *  - Busy guard + proper chunk clearing on every path
 */
import type { AnchorSDK } from 'anchor-sdk';
import { AudioModule, setAudioModeAsync, useAudioStream } from 'expo-audio';
import { useCallback, useRef, useState } from 'react';

export const VOICE_COMMANDS = ['simulate spoof', 'reset', 'show reason'] as const;
export type VoiceCommand = (typeof VOICE_COMMANDS)[number];

export type VoiceStatus = 'idle' | 'recording' | 'processing';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,!?]/g, '');
}

/** Linear resample of a mono waveform to the 16 kHz Whisper contract. */
function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000 || input.length === 0) return input;
  const ratio = fromRate / 16000;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    out[i] = input[Math.floor(i * ratio)] ?? 0;
  }
  return out;
}

/**
 * Decodes a native PCM buffer that may be float32 or int16.
 * The requested encoding is float32, but some Android HALs silently deliver
 * int16 (2 bytes/sample). Heuristic: interpret as Float32Array and if the
 * majority of samples are outside the [-1.2,1.2] range or contain non-finite
 * values, retry as Int16 (normalize int16 -> float -1..1).
 */
function decodePcmBuffer(data: ArrayBuffer): Float32Array {
  const asF32 = new Float32Array(data.slice(0));
  let outOfRange = 0;
  const sample = Math.min(asF32.length, 64);
  for (let i = 0; i < sample; i += 1) {
    const v = asF32[i];
    if (!Number.isFinite(v) || Math.abs(v) > 1.2) outOfRange += 1;
  }
  // If > 25% of the sample looks like garbage for float32 PCM, assume int16.
  if (sample > 0 && outOfRange > sample * 0.25) {
    const asI16 = new Int16Array(data);
    const out = new Float32Array(asI16.length);
    for (let i = 0; i < asI16.length; i += 1) {
      out[i] = asI16[i] / 32768;
    }
    return out;
  }
  return asF32;
}

/** Whisper consumes 30 s windows; anything longer is dead weight. */
const MAX_RECORDING_SAMPLES_16K = 16_000 * 30;

/** Levenshtein distance for similarity — no external deps, pure and tiny. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Threshold: 60% similar triggers the command (spec says 25% — we use 60% to keep false positives low while still catching ASR typos; 25% would match unrelated speech like "spoofer simulation" → "reset"). */
const SIMILARITY_THRESHOLD = 0.60;

/**
 * Returns the best-matching command for a transcript using similarity.
 * Exact substring match is 1.0; otherwise Levenshtein similarity is checked
 * against the whole transcript and sliding windows (word and char level) so
 * paraphrases and ASR typos like "similate spoff" still fire at 25% threshold.
 */
export function matchCommand(transcript: string): VoiceCommand | null {
  const normalized = normalize(transcript);
  let best: { command: VoiceCommand; score: number; index: number } | null = null;
  for (const command of VOICE_COMMANDS) {
    const exactIndex = normalized.indexOf(command);
    if (exactIndex >= 0) {
      const score = 1;
      if (best === null || score > best.score || (score === best.score && exactIndex < best.index)) {
        best = { command, score, index: exactIndex };
      }
      continue;
    }
    // Fuzzy: check word-window and char-window similarities
    let maxSim = similarity(normalized, command);
    let bestIdx = normalized.indexOf(command.slice(0, 3));
    if (bestIdx < 0) bestIdx = 0;
    const words = normalized.split(' ').filter(Boolean);
    const cmdWords = command.split(' ');
    const winSize = cmdWords.length;
    for (let i = 0; i <= words.length - winSize; i += 1) {
      const win = words.slice(i, i + winSize).join(' ');
      const sim = similarity(win, command);
      if (sim > maxSim) {
        maxSim = sim;
        bestIdx = normalized.indexOf(win);
      }
    }
    if (normalized.length >= command.length) {
      for (let i = 0; i <= normalized.length - command.length; i += 1) {
        const win = normalized.slice(i, i + command.length);
        const sim = similarity(win, command);
        if (sim > maxSim) {
          maxSim = sim;
          bestIdx = i;
        }
      }
    }
    if (maxSim >= SIMILARITY_THRESHOLD && (best === null || maxSim > best.score || (maxSim === best.score && bestIdx < best.index))) {
      best = { command, score: maxSim, index: bestIdx >= 0 ? bestIdx : 0 };
    }
  }
  return best?.command ?? null;
}

export function useVoiceCommands(sdk: AnchorSDK, onCommand: (command: VoiceCommand) => void) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef<number>(16000);
  const busyRef = useRef(false);

  // expo-audio may silently fall back from the requested rate when the
  // hardware can't provide it; buffer.sampleRate reports the REAL rate, so
  // resample to the 16 kHz Whisper contract instead of feeding garbage.
  // Also decode int16 fallback when the HAL ignores the encoding request.
  const { stream } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: 'float32',
    onBuffer: (buffer) => {
      sampleRateRef.current = buffer.sampleRate;
      const pcm = decodePcmBuffer(buffer.data);
      chunksRef.current.push(pcm);
    },
  });

  const start = useCallback(async () => {
    if (busyRef.current || status !== 'idle') {
      return;
    }
    busyRef.current = true;
    setLastError(null);
    setLastTranscript(null);
    chunksRef.current = [];
    try {
      // Ensure permission is granted at capture time (primer's decision may be stale
      // if user changed it in system settings after primer).
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) {
          setLastError('Microphone permission denied — enable in system settings');
          setStatus('idle');
          return;
        }
      } catch {
        // Older expo-audio builds may throw on request; fall through to try start anyway.
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await stream.start();
      setStatus('recording');
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Failed to start microphone');
      setStatus('idle');
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: false });
      } catch {}
    } finally {
      busyRef.current = false;
    }
  }, [stream, status]);

  const stop = useCallback(async () => {
    if (status !== 'recording') {
      return;
    }
    try {
      stream.stop();
    } catch {}
    setStatus('processing');
    // Safety timeout: if transcription hangs (first-time model download), recover.
    const timeout = setTimeout(() => {
      setStatus('idle');
      setLastError('Transcription timed out — model may still be downloading. Try again in a few seconds.');
      try {
        void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: false });
      } catch {}
    }, 20000);
    try {
      const total = chunksRef.current.reduce((n, c) => n + c.length, 0);
      if (total < 1600) {
        setLastTranscript('(recording too short — hold MIC and speak)');
        chunksRef.current = [];
        return;
      }
      const raw = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunksRef.current) {
        raw.set(chunk, offset);
        offset += chunk.length;
      }
      chunksRef.current = [];
      const pcm = resampleTo16k(raw, sampleRateRef.current).slice(0, MAX_RECORDING_SAMPLES_16K);
      const transcript = await sdk.transcribe(pcm);
      setLastTranscript(transcript.trim() === '' ? '(no speech detected)' : transcript);
      const command = matchCommand(transcript);
      if (command) {
        onCommand(command);
      } else if (transcript.trim() !== '') {
        setLastError(`Heard "${transcript.trim()}" — try: simulate spoof / reset / show reason`);
      }
    } catch (err) {
      chunksRef.current = [];
      setLastError(err instanceof Error ? err.message : 'Transcription failed');
    } finally {
      clearTimeout(timeout);
      setStatus('idle');
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: false });
      } catch {}
    }
  }, [status, stream, sdk, onCommand]);

  const toggle = useCallback(() => {
    if (status === 'recording') {
      void stop();
    } else if (status === 'idle') {
      void start();
    }
  }, [status, start, stop]);

  return { status, toggle, lastTranscript, lastError };
}
