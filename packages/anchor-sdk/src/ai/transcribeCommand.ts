import { loadSpeechToText } from './executorchRuntime';

/**
 * Transcribes spoken commands from a 16 kHz mono PCM waveform using on-device
 * Whisper base.en (ExecuTorch). Lazy: the model loads on the first call and
 * is reused afterwards.
 *
 * Returns the transcript text with surrounding whitespace trimmed; an empty
 * waveform yields an empty string rather than an error, matching Whisper's
 * own behaviour on silence.
 */
export async function transcribeCommand(audio: Float32Array): Promise<string> {
  const stt = await loadSpeechToText();
  const result = await stt.transcribe(audio);
  return result.text.trim();
}
