import { describe, expect, test } from 'bun:test';
import { busyFrom, devToolCandidates } from './live-processes';

const checkout = '/dev/acme';
const ps = [
  '  101   101 node /opt/pnpm/bin/pnpm dev',
  '  102   101 node /dev/acme/node_modules/.bin/../turbo/bin/turbo run dev',
  '  103   103 node /dev/acme-feature/node_modules/.bin/vitest run',
  '  104   104 node /Applications/Code.app/extensions/tsserver.js --useNodeIpc',
  '  105   105 -zsh',
  '  106   500 node /dev/acme/node_modules/.bin/next build',
  '  107   107 node /dev/acme/tests/scenarios/bin/scenario.cjs check',
  '  108   108 node /dev/acme/tests/scenarios/bin/scenario.mjs check',
  '  109   109 node /dev/acme/node_modules/.bin/vite build',
  '  110   110 bun /plugins/agent/mcp-server/src/server.ts'
].join('\n');
const lsofCwd = [
  'p101',
  'fcwd',
  'n/dev/acme',
  'p104',
  'fcwd',
  'n/dev/acme',
  'p105',
  'fcwd',
  'n/dev/acme/apps/api',
  'p110',
  'fcwd',
  'n/dev/acme'
].join('\n');

describe('busyFrom', () => {
  const busy = busyFrom({ checkout, candidates: devToolCandidates(ps, new Set([500]), 1), lsofCwd });

  test('finds dev tooling by cwd (pnpm dev) and by a path in its arguments (turbo, a scenario run on either entry point)', () => {
    expect(busy.map((item) => item.pid).sort()).toEqual([101, 102, 107, 108, 109]);
  });

  test("ignores a sibling worktree whose name starts with the checkout's", () => {
    expect(busy.map((item) => item.pid)).not.toContain(103);
  });

  test("ignores an editor's language server and a shell sitting in the checkout", () => {
    expect(busy.map((item) => item.pid)).not.toContain(104);
    expect(busy.map((item) => item.pid)).not.toContain(105);
  });

  test("ignores an agent session's MCP server, a bun process, even when it sits in the checkout", () => {
    expect(busy.map((item) => item.pid)).not.toContain(110);
  });

  test("ignores this gate's own process groups", () => {
    expect(busy.map((item) => item.pid)).not.toContain(106);
  });
});
