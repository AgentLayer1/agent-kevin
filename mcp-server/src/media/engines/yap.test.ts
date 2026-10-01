import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { parseYap } from './yap';

const raw = JSON.stringify({
  metadata: { created: '2026-01-02T03:04:05Z', duration: 9.5, language: 'en-US' },
  segments: [
    { id: 1, start: 0.4, end: 3.2, text: 'Open the checkout page.' },
    { id: 2, start: 4, end: 9.5, text: 'The total shows zero.', words: [{ text: 'The', start: 4, end: 4.2 }] }
  ]
});

describe('parseYap', () => {
  test('maps yap JSON to the owned transcript shape', () => {
    expect(parseYap(raw, 'en-US')).toEqual({
      engine: 'yap',
      language: 'en-US',
      duration: 9.5,
      segments: [
        { start: 0.4, end: 3.2, text: 'Open the checkout page.' },
        { start: 4, end: 9.5, text: 'The total shows zero.' }
      ]
    });
  });

  test('falls back to the requested language and the last segment end', () => {
    const bare = JSON.stringify({ metadata: {}, segments: [{ id: 1, start: 0, end: 2.5, text: 'Hi.' }] });
    expect(parseYap(bare, 'en-GB')).toMatchObject({ language: 'en-GB', duration: 2.5 });
  });

  test('rejects output without segments', () => {
    expect(() => parseYap('{"metadata":{}}', 'en-US')).toThrow();
  });
});

describe('yap', () => {
  test('a missing yap binary returns the install hint', () => {
    const script = `import { yap } from ${JSON.stringify(join(import.meta.dir, 'yap.ts'))};
await yap({ file: '/nonexistent/clip.mp4', language: 'en-US' }).catch((error) => console.log(error.message));`;
    const proc = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, PATH: '/nonexistent' } });
    expect(proc.stdout.toString()).toContain('brew install yap');
  });
});
