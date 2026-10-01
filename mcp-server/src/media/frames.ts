/**
 * Frame extraction from local video via ffmpeg — the domain logic behind the
 * `video_frames` MCP tool and (potentially) a `kevin video-frames` CLI verb.
 *
 * Runs ffmpeg out-of-band (the MCP server sits outside the Bash seatbelt), so it
 * reads videos in seatbelt-protected dirs (~/Downloads, ~/Desktop, ~/Documents)
 * that ffmpeg-under-Bash can't. Frames land in
 * `<HOME>/reports/captures/<ts>-<name>-frames/` (or a given capture folder's
 * `frames/`) as PNGs the caller Reads back for vision analysis.
 *
 * Default mode is scene-detection, not a fixed-rate dump: for a screen recording
 * of a flow it returns the moments the picture actually changed (one per step)
 * instead of dozens of near-identical frames. ffmpeg is a system dependency
 * (`brew install ffmpeg`); missing → a clean error, not a stack trace.
 */

import { BROWSER } from '@/config';
import { insideCaptures, label, resolveMediaPath, stampedDir } from '@/media/files';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const PTS_TIME_RE = /pts_time:([0-9.]+)/g;

export type FrameMode = 'scene' | 'interval' | 'count' | 'at';

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
  /** at mode: seconds to grab one frame each. */
  times?: number[];
  maxFrames?: number;
  width?: number;
  name?: string;
  /** Existing folder under the captures dir (e.g. from media_transcribe); each call adds a subfolder of its `frames/`. */
  dir?: string;
}

export interface FrameExtraction {
  dir: string;
  mode: FrameMode;
  count: number;
  note?: string;
  frames: ExtractedFrame[];
}

/** Parse the source duration in seconds from ffmpeg's `-i` banner (no ffprobe needed). */
function probeDuration(videoPath: string): number | null {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-i', videoPath], { encoding: 'utf8' });
  const match = DURATION_RE.exec(out.stderr ?? '');
  if (!match) return null;
  const [, hh, mm, ss] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

/** Even spread of `n` frames across the whole video; needs duration to space them. */
function evenSpread(videoPath: string, n: number): { filter: string; note?: string } {
  const duration = probeDuration(videoPath);
  if (!duration) return { filter: 'fps=1/5', note: 'duration unknown; sampled every 5s' };
  return { filter: `fps=1/${Math.max(duration / n, 0.1)}` };
}

function spawnFfmpeg(args: string[]): string {
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
  return run.stderr ?? '';
}

/** Run one ffmpeg extraction pass; returns frames with parsed timestamps, ordered. */
function runFfmpeg(videoPath: string, filter: string, width: number, outDir: string): ExtractedFrame[] {
  const vf = `${filter},scale='min(${width},iw)':-2,showinfo`;
  const stderr = spawnFfmpeg([
    '-hide_banner',
    '-i',
    videoPath,
    '-vf',
    vf,
    '-vsync',
    'vfr',
    resolve(outDir, 'frame_%04d.png')
  ]);

  const times: number[] = [];
  for (const m of stderr.matchAll(PTS_TIME_RE)) {
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

/** At most `max` items, evenly spaced. */
function spread<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const keep = new Set(Array.from({ length: max }, (_unused, index) => Math.floor(index * step)));
  return items.filter((_item, index) => keep.has(index));
}

const distinctTenths = (times: number[]): number[] =>
  [...new Set(times.map((t) => Math.round(t * 10) / 10))].sort((a, b) => a - b);

/** One frame per requested second, seeking straight to each; times past the end yield none. */
function runAt(videoPath: string, times: number[], width: number, outDir: string): ExtractedFrame[] {
  return times
    .map((t) => {
      const path = resolve(outDir, `at-${t.toFixed(1)}s.png`);
      spawnFfmpeg([
        '-hide_banner',
        '-ss',
        String(t),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${width},iw)':-2`,
        path
      ]);
      return { path, t, label: label(t) };
    })
    .filter((frame) => existsSync(frame.path));
}

function samplePasses(
  videoPath: string,
  options: ExtractFramesOptions,
  width: number,
  outDir: string
): { frames: ExtractedFrame[]; note?: string } {
  const mode = options.mode ?? 'scene';
  const chosen =
    mode === 'scene'
      ? { filter: `select='gt(scene,${options.threshold ?? 0.3})'` }
      : mode === 'interval'
        ? { filter: `fps=1/${options.everySeconds ?? 5}` }
        : evenSpread(videoPath, options.count ?? 12);
  const frames = runFfmpeg(videoPath, chosen.filter, width, outDir);
  if (mode === 'scene' && frames.length < 2) {
    return {
      frames: runFfmpeg(videoPath, evenSpread(videoPath, 12).filter, width, outDir),
      note: 'scene detection found no cuts; fell back to 12 evenly-spaced frames'
    };
  }
  return { frames, note: chosen.note };
}

/** Extract analysable still frames from a local video. Throws on missing ffmpeg or file. */
export function extractFrames(options: ExtractFramesOptions): FrameExtraction {
  const videoPath = resolveMediaPath(options.video);
  if (!existsSync(videoPath)) {
    throw new Error(`Video not found: ${videoPath}`);
  }
  const mode = options.mode ?? 'scene';
  if (mode === 'at' && !options.times?.length) {
    throw new Error('at mode needs `times`: the seconds to grab, e.g. [12, 73.5].');
  }

  const width = options.width ?? 1280;
  const max = options.maxFrames ?? 30;
  const outDir = options.dir
    ? stampedDir(resolve(insideCaptures(options.dir), 'frames'), mode)
    : stampedDir(BROWSER.CAPTURES_DIR, `${options.name ?? 'video'}-frames`);
  mkdirSync(outDir, { recursive: true });

  const { frames, note } =
    mode === 'at'
      ? { frames: runAt(videoPath, spread(distinctTenths(options.times ?? []), max), width, outDir), note: undefined }
      : samplePasses(videoPath, options, width, outDir);
  const kept = spread(frames, max);
  frames.filter((frame) => !kept.includes(frame)).forEach((frame) => rmSync(frame.path, { force: true }));
  return { dir: outDir, mode, count: kept.length, ...(note ? { note } : {}), frames: kept };
}
