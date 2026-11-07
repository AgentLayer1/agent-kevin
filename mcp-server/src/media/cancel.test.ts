import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { yap } from './engines/yap';
import { extractFrames } from './frames';

const root = mkdtempSync(join(tmpdir(), 'media-cancel-'));
const video = join(root, 'clip.mp4');
const path = process.env.PATH;

beforeAll(() => {
  mkdirSync(join(root, 'bin'));
  ['ffmpeg', 'yap'].forEach((tool) => writeFileSync(join(root, 'bin', tool), '#!/bin/sh\nsleep 30\n', { mode: 0o755 }));
  writeFileSync(video, '');
  process.env.PATH = `${join(root, 'bin')}:${path}`;
});

afterAll(() => {
  process.env.PATH = path;
  rmSync(root, { recursive: true, force: true });
});

const cancelSoon = (): AbortSignal => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  return controller.signal;
};

describe('a cancelled media call', () => {
  test('stops a hung ffmpeg instead of waiting it out', async () => {
    const started = Date.now();

    await expect(extractFrames({ video, mode: 'interval', signal: cancelSoon() })).rejects.toThrow(
      'ffmpeg was cancelled.'
    );
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('stops a hung transcription instead of waiting it out', async () => {
    const started = Date.now();

    await expect(yap({ file: video, language: 'en-US', signal: cancelSoon() })).rejects.toThrow('yap was cancelled.');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
