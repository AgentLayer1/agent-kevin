import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOME = mkdtempSync(resolve(tmpdir(), 'kevin-inbox-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

const INBOX = resolve(HOME, 'knowledge', 'raw', 'inbox');
const ARCHIVE = resolve(HOME, 'knowledge', 'raw', 'archive', 'inbox');

let pickNext: typeof import('@/knowledge/compile').pickNext;
let markComplete: typeof import('@/knowledge/compile').markComplete;
let getStatus: typeof import('@/knowledge/compile').getStatus;

beforeAll(async () => {
  mkdirSync(resolve(HOME, '.kevin'), { recursive: true });
  writeFileSync(resolve(HOME, '.kevin', 'version.json'), '{}\n');
  mkdirSync(join(INBOX, 'acme-history', 'notes'), { recursive: true });
  mkdirSync(join(INBOX, '.hidden'), { recursive: true });
  writeFileSync(join(INBOX, 'acme-history', '00-readme.md'), '# Readme\n');
  writeFileSync(join(INBOX, 'acme-history', 'notes', '05-decisions.md'), '# Decisions\n');
  writeFileSync(join(INBOX, 'acme-history', '.DS_Store'), '');
  writeFileSync(join(INBOX, '.hidden', 'skip.md'), '# Skip\n');
  writeFileSync(join(INBOX, 'loose.md'), '# Loose\n');
  ({ pickNext, markComplete, getStatus } = await import('@/knowledge/compile'));
});

afterAll(() => {
  process.env.AGENT_HOME = PRELOAD_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

describe('inbox folders', () => {
  test('files inside a dropped folder count as pending, dotfiles and dot-folders do not', async () => {
    expect((await getStatus()).pending.inbox).toBe(3);
  });

  test('a nested file compiles under its folder path and archives with its structure', async () => {
    const item = await pickNext();
    expect(item?.itemId).toBe(join('inbox:acme-history', '00-readme.md'));
    expect(item?.prompt).toContain('raw/archive/inbox/acme-history/00-readme.md');

    await markComplete(item?.itemId ?? '');
    expect(existsSync(join(ARCHIVE, 'acme-history', '00-readme.md'))).toBe(true);
    expect(existsSync(join(INBOX, 'acme-history', '00-readme.md'))).toBe(false);
  });

  test('the folder is removed once its last file is archived, leaving loose files alone', async () => {
    const item = await pickNext();
    expect(item?.itemId).toBe(join('inbox:acme-history', 'notes', '05-decisions.md'));
    await markComplete(item?.itemId ?? '');

    expect(existsSync(join(ARCHIVE, 'acme-history', 'notes', '05-decisions.md'))).toBe(true);
    expect(existsSync(join(INBOX, 'acme-history'))).toBe(false);
    expect(existsSync(join(INBOX, 'loose.md'))).toBe(true);
    expect((await getStatus()).pending.inbox).toBe(1);
  });

  test('an item id that points outside the inbox is rejected', async () => {
    await expect(markComplete('inbox:../../USER.md')).rejects.toThrow('outside the inbox');
  });
});
