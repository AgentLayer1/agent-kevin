/**
 * Speech-to-text for a local audio or video file — the domain logic behind the
 * `media_transcribe` MCP tool. Runs outside the Bash seatbelt (like `video_frames`),
 * so it reads media in ~/Downloads, ~/Desktop and ~/Documents.
 */

import { BROWSER } from '@/config';
import { yap } from '@/media/engines/yap';
import { label, resolveMediaPath, stampedDir } from '@/media/files';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface TranscriptSegment {
  /** Seconds from the start of the media. */
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  engine: string;
  /** BCP-47 language of the speech, e.g. `en-US`. */
  language: string;
  duration: number;
  segments: TranscriptSegment[];
}

export type TranscribeEngine = (input: { file: string; language: string }) => Promise<Transcript>;

export interface TranscribeOptions {
  file: string;
  /** BCP-47 language spoken in the media (default `en-US`); the engine decides what it supports. */
  language?: string;
  name?: string;
}

export interface TranscriptResult extends Omit<Transcript, 'segments'> {
  dir: string;
  segmentCount: number;
  transcriptPath: string;
  jsonPath: string;
}

const ENGINES: Partial<Record<NodeJS.Platform, TranscribeEngine>> = { darwin: yap };

export const engineFor = (platform: NodeJS.Platform): TranscribeEngine => {
  const engine = ENGINES[platform];
  if (!engine) {
    // TODO(windows): add an engine in engines/ (whisper.cpp also covers Linux) and map it here.
    throw new Error(`Transcription isn't supported on ${platform} yet; it needs macOS 26+ for now.`);
  }
  return engine;
};

export const toMarkdown = (transcript: Transcript): string =>
  `${transcript.segments.map((segment) => `[${label(segment.start)}] ${segment.text}`).join('\n')}\n`;

/** Transcribe a local audio or video file into `<captures>/<stamp>-<name>/transcript.{json,md}`. */
export const transcribe = async (options: TranscribeOptions): Promise<TranscriptResult> => {
  const file = resolveMediaPath(options.file);
  if (!existsSync(file)) {
    throw new Error(`Media not found: ${file}`);
  }
  const transcript = await engineFor(process.platform)({ file, language: options.language ?? 'en-US' });

  const dir = stampedDir(BROWSER.CAPTURES_DIR, options.name ?? 'media');
  mkdirSync(dir, { recursive: true });
  const jsonPath = resolve(dir, 'transcript.json');
  const transcriptPath = resolve(dir, 'transcript.md');
  writeFileSync(jsonPath, `${JSON.stringify(transcript, null, 2)}\n`);
  writeFileSync(transcriptPath, toMarkdown(transcript));

  return {
    dir,
    engine: transcript.engine,
    language: transcript.language,
    duration: transcript.duration,
    segmentCount: transcript.segments.length,
    transcriptPath,
    jsonPath
  };
};
