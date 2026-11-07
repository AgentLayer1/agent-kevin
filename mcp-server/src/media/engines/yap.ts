/**
 * macOS transcription engine: Apple's on-device SpeechAnalyzer through the `yap` CLI
 * (`brew install yap`, macOS 26+). Audio never leaves the machine, and yap reads a
 * video's soundtrack itself, so audio and video files go in as they are.
 */

import type { TranscribeEngine, Transcript } from '@/media/transcribe';
import { runGroup } from '@/shared/process-group';
import { dirname } from 'node:path';
import { z } from 'zod';

const YAP_TIMEOUT_MS = 1_800_000;

const YapOutput = z.object({
  metadata: z.object({ duration: z.number().optional(), language: z.string().optional() }),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() }))
});

export const parseYap = (raw: string, language: string): Transcript => {
  const { metadata, segments } = YapOutput.parse(JSON.parse(raw));
  return {
    engine: 'yap',
    language: metadata.language ?? language,
    duration: metadata.duration ?? segments.at(-1)?.end ?? 0,
    segments
  };
};

// yap silences its progress output when stdout is piped, so stdout is the JSON alone.
export const yap: TranscribeEngine = async ({ file, language, signal }) => {
  const run = await runGroup(['yap', 'transcribe', `--locale=${language}`, '--json', '-m', '200', file], {
    cwd: dirname(file),
    timeoutMs: YAP_TIMEOUT_MS,
    signal
  }).catch((error: NodeJS.ErrnoException) => {
    throw new Error(
      error.code === 'ENOENT'
        ? 'yap not found. Install it with `brew install yap` (macOS 26+) from a normal terminal, then retry.'
        : `yap failed: ${error.message}`
    );
  });
  if (run.stopped) {
    throw new Error(run.stopped === 'cancel' ? 'yap was cancelled.' : `yap stopped after ${YAP_TIMEOUT_MS / 60_000} minutes.`);
  }
  if (run.exitCode !== 0) {
    throw new Error(`yap failed: ${run.stderr.trim() || `exit ${run.exitCode}`}`);
  }
  return parseYap(run.stdout, language);
};
