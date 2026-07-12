/**
 * Frame extraction from local video via ffmpeg — the domain logic behind the
 * `video_frames` MCP tool and (potentially) a `kevin video-frames` CLI verb.
 *
 * Runs ffmpeg out-of-band (the MCP server sits outside the Bash seatbelt), so it
 * reads videos in seatbelt-protected dirs (~/Downloads, ~/Desktop, ~/Documents)
 * that ffmpeg-under-Bash can't. Frames land in
 * `<KEVIN_HOME>/reports/captures/<ts>-<name>-frames/` as PNGs the caller Reads
 * back for vision analysis.
 *
 * Default mode is scene-detection, not a fixed-rate dump: for a screen recording
 * of a flow it returns the moments the picture actually changed (one per step)
 * instead of dozens of near-identical frames. ffmpeg is a system dependency
 * (`brew install ffmpeg`); missing → a clean error, not a stack trace.
 */

import { FOLDERS } from '@/config';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPTURES_DIR = resolve(FOLDERS.REPORTS, 'captures');
const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const PTS_TIME_RE = /pts_time:([0-9.]+)/g;

export type FrameMode = 'scene' | 'interval' | 'count';

export interface ExtractedFrame {
  /** Absolute path to the PNG. */
  path: string;
  /** Timestamp in the source video, seconds. */
  t: number;
  /** Human label, mm:ss. */
  label: string;
}

export interface ExtractFramesOptions {
  video: string;
  mode?: FrameMode;
  threshold?: number;
  everySeconds?: number;
  count?: number;
  maxFrames?: number;
  width?: number;
  name?: string;
}

export interface FrameExtraction {
  dir: string;
  mode: FrameMode;
  count: number;
  note?: string;
  frames: ExtractedFrame[];
}

function resolveVideoPath(input: string): string {
  if (input.startsWith('file://')) return fileURLToPath(input);
  const expanded = input.startsWith('~') ? resolve(homedir(), input.slice(input.indexOf('/') + 1)) : input;
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

/** Parse the source duration in seconds from ffmpeg's `-i` banner (no ffprobe needed). */
function probeDuration(videoPath: string): number | null {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-i', videoPath], { encoding: 'utf8' });
  const match = DURATION_RE.exec(out.stderr ?? '');
  if (!match) return null;
  const [, hh, mm, ss] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

function label(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Even spread of `n` frames across the whole video; needs duration to space them. */
function evenSpread(videoPath: string, n: number): { filter: string; note?: string } {
  const duration = probeDuration(videoPath);
  if (!duration) return { filter: 'fps=1/5', note: 'duration unknown; sampled every 5s' };
  return { filter: `fps=1/${Math.max(duration / n, 0.1)}` };
}

/** Run one ffmpeg extraction pass; returns frames with parsed timestamps, ordered. */
function runFfmpeg(videoPath: string, filter: string, width: number, outDir: string): ExtractedFrame[] {
  mkdirSync(outDir, { recursive: true });
  const vf = `${filter},scale='min(${width},iw)':-2,showinfo`;
  const args = ['-hide_banner', '-i', videoPath, '-vf', vf, '-vsync', 'vfr', resolve(outDir, 'frame_%04d.png')];
  const run = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) {
    const { code } = run.error as NodeJS.ErrnoException;
    throw new Error(
      code === 'ENOENT'
        ? 'ffmpeg not found. Install it with `brew install ffmpeg` (macOS) from a normal terminal, then retry.'
        : `ffmpeg could not run: ${run.error.message}`
    );
  }
  if (run.status !== 0) {
    throw new Error(`ffmpeg failed: ${(run.stderr ?? '').trim().split('\n').slice(-3).join(' ')}`);
  }

  const times: number[] = [];
  for (const m of (run.stderr ?? '').matchAll(PTS_TIME_RE)) {
    times.push(Number(m[1]));
  }
  return readdirSync(outDir)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name, index) => {
      const t = times[index] ?? 0;
      return { path: resolve(outDir, name), t, label: label(t) };
    });
}

/** Keep at most `max` frames, evenly spaced; delete the rest from disk. */
function capFrames(frames: ExtractedFrame[], max: number): ExtractedFrame[] {
  if (frames.length <= max) return frames;
  const step = frames.length / max;
  const keep = new Set(Array.from({ length: max }, (_unused, index) => Math.floor(index * step)));
  return frames.filter((frame, index) => {
    if (keep.has(index)) return true;
    rmSync(frame.path, { force: true });
    return false;
  });
}

/** Extract analysable still frames from a local video. Throws on missing ffmpeg or file. */
export function extractFrames(options: ExtractFramesOptions): FrameExtraction {
  const videoPath = resolveVideoPath(options.video);
  if (!existsSync(videoPath)) {
    throw new Error(`Video not found: ${videoPath}`);
  }

  const mode = options.mode ?? 'scene';
  const width = options.width ?? 1280;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(CAPTURES_DIR, `${stamp}-${options.name ?? 'video'}-frames`);

  const chosen =
    mode === 'scene'
      ? { filter: `select='gt(scene,${options.threshold ?? 0.3})'` }
      : mode === 'interval'
        ? { filter: `fps=1/${options.everySeconds ?? 5}` }
        : evenSpread(videoPath, options.count ?? 12);

  let frames = runFfmpeg(videoPath, chosen.filter, width, outDir);
  let note = chosen.note;

  // Scene detection on a near-static video can yield 0-1 frames; fall back to an
  // even spread so the caller always gets something usable.
  if (mode === 'scene' && frames.length < 2) {
    frames = runFfmpeg(videoPath, evenSpread(videoPath, 12).filter, width, outDir);
    note = 'scene detection found no cuts; fell back to 12 evenly-spaced frames';
  }

  frames = capFrames(frames, options.maxFrames ?? 30);
  return { dir: outDir, mode, count: frames.length, ...(note ? { note } : {}), frames };
}
