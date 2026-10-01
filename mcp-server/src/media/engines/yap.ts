/**
 * macOS transcription engine: Apple's on-device SpeechAnalyzer through the `yap` CLI
 * (`brew install yap`, macOS 26+). Audio never leaves the machine, and yap reads a
 * video's soundtrack itself, so audio and video files go in as they are.
 */

import type { TranscribeEngine, Transcript } from '@/media/transcribe';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

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
export const yap: TranscribeEngine = async ({ file, language }) => {
  try {
    const { stdout } = await execFileAsync('yap', ['transcribe', `--locale=${language}`, '--json', '-m', '200', file], {
      maxBuffer: 64 * 1024 * 1024
    });
    return parseYap(stdout, language);
  } catch (error) {
    const failure = error as { code?: string; stderr?: string; message?: string };
    if (failure.code === 'ENOENT') {
      throw new Error(
        'yap not found. Install it with `brew install yap` (macOS 26+) from a normal terminal, then retry.'
      );
    }
    throw new Error(`yap failed: ${(failure.stderr || failure.message || String(error)).trim()}`);
  }
};
