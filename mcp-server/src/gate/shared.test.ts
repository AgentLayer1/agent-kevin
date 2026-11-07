import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import manifest from './shared.json';

const pluginRoot = resolve(import.meta.dir, '..', '..', '..');

describe('the gate engine shared with the sibling plugin', () => {
  test.each(manifest.files.map(({ path, sha256 }) => [path, sha256]))(
    '%s matches its hash in gate/shared.json',
    (path, sha256) => {
      const actual = createHash('sha256')
        .update(readFileSync(join(pluginRoot, path)))
        .digest('hex');

      expect(
        actual,
        `${path} changed. Run bun scripts/sync-gate.ts --to <the sibling plugin>, so both plugins carry the same engine.`
      ).toBe(sha256);
    }
  );
});
