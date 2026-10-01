import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
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

describe('inbox zips and binary files', () => {
  test.skipIf(!Bun.which('zip'))('a dropped zip is unpacked beside itself and the zip is archived', async () => {
    const staging = mkdtempSync(resolve(tmpdir(), 'kevin-zip-'));
    mkdirSync(join(staging, 'bundle-notes'));
    writeFileSync(join(staging, 'bundle-notes', 'one.md'), '# One\n');
    execFileSync('zip', ['-qr', join(INBOX, 'bundle.zip'), 'bundle-notes'], { cwd: staging });
    rmSync(staging, { recursive: true, force: true });

    const item = await pickNext();
    expect(item?.itemId).toBe(join('inbox:bundle', 'bundle-notes', 'one.md'));
    expect(existsSync(join(INBOX, 'bundle.zip'))).toBe(false);
    expect(existsSync(join(ARCHIVE, 'bundle.zip'))).toBe(true);

    await markComplete(item?.itemId ?? '');
    expect(existsSync(join(INBOX, 'bundle'))).toBe(false);
  });

  test('a file that is not a zip fails loudly and stays put', async () => {
    writeFileSync(join(INBOX, 'broken.zip'), 'not a zip');
    await expect(pickNext()).rejects.toThrow('Could not unzip broken.zip');
    expect(existsSync(join(INBOX, 'broken'))).toBe(false);
    rmSync(join(INBOX, 'broken.zip'));
  });

  test('a PDF is handed over by path instead of inlined as text', async () => {
    writeFileSync(join(INBOX, 'deck.pdf'), Buffer.from('%PDF-1.4\n\u0000binary stream'));
    const item = await pickNext();
    expect(item?.itemId).toBe('inbox:deck.pdf');
    expect(item?.prompt).toContain(join(INBOX, 'deck.pdf'));
    expect(item?.prompt).not.toContain('%PDF-1.4');
  });
});
