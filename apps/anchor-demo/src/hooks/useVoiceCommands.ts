/**
 * useVoiceCommands — hold-the-mic capture: real-time 16 kHz mono float32 PCM
 * via expo-audio's AudioStream (fully offline, no file decode), then
 * sdk.transcribe and simple string matching against the fixed command set.
 */
import type { AnchorSDK } from 'anchor-sdk';
import { useAudioStream, setAudioModeAsync } from 'expo-audio';
import { useCallback, useRef, useState } from 'react';

export const VOICE_COMMANDS = ['simulate spoof', 'reset', 'show reason'] as const;
export type VoiceCommand = (typeof VOICE_COMMANDS)[number];

export type VoiceStatus = 'idle' | 'recording' | 'processing';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,!?]/g, '');
}

/** Returns the first fixed command contained in the transcript, if any. */
export function matchCommand(transcript: string): VoiceCommand | null {
  const normalized = normalize(transcript);
  for (const command of VOICE_COMMANDS) {
    if (normalized.includes(command)) {
      return command;
    }
  }
  return null;
}

export function useVoiceCommands(sdk: AnchorSDK, onCommand: (command: VoiceCommand) => void) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const busyRef = useRef(false);

  const { stream, isStreaming } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: 'float32',
    onBuffer: (buffer) => {
      chunksRef.current.push(new Float32Array(buffer.data));
    },
  });

  const start = useCallback(async () => {
    if (busyRef.current || isStreaming) {
      return;
    }
    busyRef.current = true;
    setLastError(null);
    setLastTranscript(null);
    chunksRef.current = [];
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await stream.start();
      setStatus('recording');
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Failed to start microphone');
    } finally {
      busyRef.current = false;
    }
  }, [stream, isStreaming]);

  const stop = useCallback(async () => {
    if (!isStreaming) {
      return;
    }
    stream.stop();
    setStatus('processing');
    try {
      const total = chunksRef.current.reduce((n, c) => n + c.length, 0);
      if (total < 1600) {
        setLastTranscript('(recording too short)');
        return;
      }
      const pcm = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunksRef.current) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      chunksRef.current = [];
      const transcript = await sdk.transcribe(pcm);
      setLastTranscript(transcript.trim() === '' ? '(no speech detected)' : transcript);
      const command = matchCommand(transcript);
      if (command) {
        onCommand(command);
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Transcription failed');
    } finally {
      setStatus('idle');
    }
  }, [isStreaming, stream, sdk, onCommand]);

  const toggle = useCallback(() => {
    if (status === 'recording') {
      void stop();
    } else if (status === 'idle') {
      void start();
    }
  }, [status, start, stop]);

  return { status, toggle, lastTranscript, lastError };
}
