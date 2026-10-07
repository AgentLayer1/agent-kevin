import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import { BAND_PROPS, CODE, HOME, USER_HOME, fakeHost, machine, run } from './fake-host';

const APP = `${CODE}/app`;
const DOCS = `${CODE}/docs-only`;
const LIB = `${USER_HOME}/granted/lib`;

const repo = () =>
  machine({
    folders: [
      CODE,
      APP,
      `${APP}/.git`,
      `${APP}/packages`,
      `${APP}/packages/ui`,
      `${APP}/packages/kit`,
      DOCS,
      `${DOCS}/.git`,
      `${DOCS}/docs`,
      LIB,
      `${LIB}/.git`,
      `${CODE}/other-home`,
      `${CODE}/other-home/.git`,
      `${CODE}/soul-only`,
      `${CODE}/soul-only/.git`
    ],
    files: {
      [`${APP}/.claude/CLAUDE.md`]: '@../AGENTS.md\n\nClaude-only: use the xcode server.',
      [`${APP}/AGENTS.md`]: '# App manual\nBuild with bun.',
      [`${APP}/CLAUDE.local.md`]: '# My local notes',
      [`${APP}/README.md`]: 'readme',
      [`${APP}/packages/ui/AGENTS.md`]: '# UI package manual',
      [`${APP}/packages/ui/button.ts`]: 'export {}',
      [`${APP}/packages/kit/CLAUDE.md`]: 'Kit rules. @../../AGENTS.md',
      [`${APP}/packages/kit/index.ts`]: 'export {}',
      [`${DOCS}/AGENTS.md`]:
        '# Docs-only manual\nSee @docs/style.md, never @/etc/secret.md.\n\n```\n@docs/ignored.md\n```\n',
      [`${DOCS}/docs/style.md`]: '# Style guide',
      [`${DOCS}/docs/ignored.md`]: '# Should not load',
      [`${DOCS}/index.ts`]: 'export {}',
      '/etc/secret.md': 'secret',
      [`${LIB}/.claude/CLAUDE.md`]: '@../AGENTS.md\n',
      [`${LIB}/AGENTS.md`]: '# Lib manual',
      [`${LIB}/index.ts`]: 'export {}',
      [`${HOME}/notes.md`]: 'home note',
      [`${CODE}/other-home/.data/version.json`]: '{}',
      [`${CODE}/soul-only/SOUL.md`]: '# Soul',
      [`${CODE}/soul-only/AGENTS.md`]: '# Soul-only manual',
      [`${CODE}/soul-only/index.ts`]: 'export {}',
      [`${CODE}/other-home/AGENTS.md`]: '# Another agent home manual',
      [`${CODE}/other-home/USER.md`]: 'user',
      '/elsewhere/repo/file.ts': 'export {}'
    }
  });

const contextOf = (result: { context?: readonly string[] }): string[] => [...(result.context ?? [])];
const attachedPaths = (result: { context?: readonly string[] }): string[] =>
  contextOf(result).map((entry) => /^Contents of (\S+)/.exec(entry)?.[1] ?? '');
const read = ($: Engine, file_path: string) => $.tool.call({ tool: 'Read', file_path });

describe('repo instructions', () => {
  test("mirrors Claude Code: the folder's Claude files with imports expanded, then nested folders", async ($, on) => {
    fakeHost(on, repo());
    expect(attachedPaths(await read($, `${APP}/packages/ui/button.ts`))).toEqual([
      `${APP}/.claude/CLAUDE.md`,
      `${APP}/AGENTS.md`,
      `${APP}/CLAUDE.local.md`,
      `${APP}/packages/ui/AGENTS.md`
    ]);
  });

  test('a file reached through two imports is attached once', async ($, on) => {
    fakeHost(on, repo());
    expect(attachedPaths(await read($, `${APP}/packages/kit/index.ts`))).toEqual([
      `${APP}/.claude/CLAUDE.md`,
      `${APP}/AGENTS.md`,
      `${APP}/CLAUDE.local.md`,
      `${APP}/packages/kit/CLAUDE.md`
    ]);
  });

  test('AGENTS.md is the fallback, its imports load, code spans and paths outside the grants do not', async ($, on) => {
    fakeHost(on, repo());
    expect(attachedPaths(await read($, `${DOCS}/index.ts`))).toEqual([`${DOCS}/AGENTS.md`, `${DOCS}/docs/style.md`]);
  });

  test('a bridge holding only its import attaches just what it imports', async ($, on) => {
    fakeHost(on, repo());
    expect(attachedPaths(await read($, `${LIB}/index.ts`))).toEqual([`${LIB}/AGENTS.md`]);
  });

  test('a repeat touch in a folder already read costs no filesystem calls', async ($, on) => {
    const host = fakeHost(on, repo());
    await read($, `${APP}/packages/ui/button.ts`);
    const before = host.fsCalls.length;
    expect(contextOf(await read($, `${APP}/packages/ui/button.ts`))).toEqual([]);
    expect(host.fsCalls.length - before).toBe(0);
  });

  test('a second touch in the same repo attaches nothing', async ($, on) => {
    fakeHost(on, repo());
    await read($, `${APP}/README.md`);
    expect(contextOf(await $.tool.call({ tool: 'Write', file_path: `${APP}/NOTES.md`, content: 'x' }))).toEqual([]);
  });

  test('files outside the grants, under the session root or in an agent home attach nothing', async ($, on) => {
    fakeHost(on, repo());
    expect(contextOf(await read($, '/elsewhere/repo/file.ts'))).toEqual([]);
    expect(contextOf(await read($, `${HOME}/notes.md`))).toEqual([]);
    expect(contextOf(await read($, `${CODE}/other-home/USER.md`))).toEqual([]);
  });

  test('a SOUL.md alone no longer marks an agent home', async ($, on) => {
    fakeHost(on, repo());
    expect(attachedPaths(await read($, `${CODE}/soul-only/index.ts`))).toEqual([`${CODE}/soul-only/AGENTS.md`]);
  });

  test('a shell command naming a repo folder attaches its instructions', async ($, on) => {
    fakeHost(on, repo());
    const result = await $.tool.call({ tool: 'Bash', command: `git -C ${LIB} status` });
    expect(attachedPaths(result)).toEqual([`${LIB}/AGENTS.md`]);
  });

  test("a path spelled with '.' or '..' attaches nothing already attached", async ($, on) => {
    fakeHost(on, repo());
    await read($, `${APP}/packages/kit/index.ts`);
    expect(contextOf(await $.tool.call({ tool: 'Bash', command: `cp -R ${APP}/packages/kit/. /out` }))).toEqual([]);
    expect(attachedPaths(await read($, `${APP}/packages/kit/../ui/button.ts`))).toEqual([
      `${APP}/packages/ui/AGENTS.md`
    ]);
  });

  test('reading an instruction file itself does not attach it again', async ($, on) => {
    fakeHost(on, repo());
    expect(attachedPaths(await read($, `${APP}/AGENTS.md`))).not.toContain(`${APP}/AGENTS.md`);
  });

  test('compaction and /clear each let the next touch attach again', async ($, on) => {
    fakeHost(on, repo());
    await read($, `${APP}/README.md`);
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] });
    expect(attachedPaths(await read($, `${APP}/README.md`))).toContain(`${APP}/AGENTS.md`);
    await $.session.end({ reason: 'clear', sessionId: 'first', resume: { id: 'first' } });
    expect(attachedPaths(await read($, `${APP}/README.md`))).toContain(`${APP}/AGENTS.md`);
  });

  test('a precomputed or vetoed compaction keeps what is attached', async ($, on) => {
    on('session.compact', { trigger: 'auto' }, () => ({ skip: 'vetoed' }));
    fakeHost(on, repo());
    await read($, `${APP}/README.md`);
    await $.session.compact({ trigger: 'precompute', messages: [{ role: 'user', text: 'summary', toolUses: [] }] });
    await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'summary', toolUses: [] }] });
    expect(attachedPaths(await read($, `${APP}/README.md`))).not.toContain(`${APP}/AGENTS.md`);
  });

  test('/manuals lists what is in context', async ($, on) => {
    fakeHost(on, repo());
    expect((await run($, 'manuals')).text).toBe('No repo instructions attached yet.');
    await read($, `${LIB}/index.ts`);
    expect((await run($, 'manuals')).text).toBe('In context: granted/lib/AGENTS.md');
  });
});

describe('attach row', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`names what this turn attached, stacks with the sync band, and clears when the turn ends on ${surface}`, async ($, on) => {
      fakeHost(on, repo());
      await $.skill.prompt({ skill: 'agent-kevin:sync', text: 'SYNC' });
      await read($, `${LIB}/index.ts`);
      const mount = () => $.ui.mount({ plugin: 'agent-kevin', surface, component: 'AbovePrompt', props: BAND_PROPS });
      const texts = async () =>
        (await (await mount()).findAll({ type: 'Text' })).map((element) => element.text).join('');
      expect(await texts()).toContain('📎 granted/lib/AGENTS.md attached');
      expect(await texts()).toContain('⟳ sync · running');
      await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' });
      expect(await texts()).not.toContain('📎');
    });
  }
});
