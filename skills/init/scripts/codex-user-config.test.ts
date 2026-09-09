import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, 'codex-user-config.ts');
const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-user-'));
  dirs.push(dir);
  return dir;
};
const NO_RULES = join(tmpdir(), 'codex-user-no-rules-file');
const run = (...extra: string[]) => {
  const rules = extra.includes('--rules') ? [] : ['--rules', NO_RULES];
  const proc = spawnSync(process.execPath, [SCRIPT, '--home', '/Users/ada/Agents/Scout', ...extra, ...rules], {
    encoding: 'utf-8'
  });
  return { code: proc.status, json: proc.stdout.trim() ? JSON.parse(proc.stdout) : null, stderr: proc.stderr };
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('codex-user-config', () => {
  test('an absent user config gets the whole block, with top-level keys before the tables', () => {
    const dir = scratch();
    const { code, json } = run('--config', join(dir, 'none.toml'), '--claude-settings', join(dir, 'none.json'));
    expect(code).toBe(0);
    expect(json.status).toBe('absent');
    expect(
      json.block.startsWith(
        'approval_policy = "on-request"\napprovals_reviewer = "user"\ncheck_for_update_on_startup = true\n\n[analytics]'
      )
    ).toBe(true);
    expect(json.block).toContain('[tui]\nanimations = false\nalternate_screen = "never"');
    expect(json.missing.map((m: { key: string }) => m.key)).not.toContain('model_reasoning_effort');
    expect(Bun.TOML.parse(json.block)).toMatchObject({ otel: { exporter: 'none', log_user_prompt: false } });
    expect(json.profileBlock).toContain('default_permissions = "everyday"');
    expect(json.profileBlock).toContain('"**/.env.*" = "deny"');
    expect(json.rulesBlock).toBe('');
  });

  test('only the keys that differ are listed, an existing table is marked, and the Claude effort level maps onto reasoning effort', () => {
    const dir = scratch();
    const config = join(dir, 'config.toml');
    writeFileSync(config, '[analytics]\nenabled = false\n\n[tui]\nanimations = false\nalternate_screen = "auto"\n');
    const claude = join(dir, 'settings.json');
    writeFileSync(claude, JSON.stringify({ effortLevel: 'max' }));
    const { json } = run('--config', config, '--claude-settings', claude);
    expect(json.status).toBe('partial');
    const keys = json.missing.map((m: { key: string }) => m.key);
    expect(keys).toContain('model_reasoning_effort');
    expect(keys).toContain('tui.alternate_screen');
    expect(keys).not.toContain('analytics.enabled');
    expect(keys).not.toContain('tui.animations');
    expect(json.block).toContain('model_reasoning_effort = "xhigh"');
    expect(json.block).toContain('# inside your existing [tui] table:\nalternate_screen = "never"');
    expect(json.block).not.toContain('[tui]\n');
  });

  test("recommends a profile from Claude's user denies and rules from its ask list, only while the user config lacks them", () => {
    const dir = scratch();
    const claude = join(dir, 'settings.json');
    writeFileSync(
      claude,
      JSON.stringify({
        permissions: {
          deny: ['Read(~/.ssh/id_*)', 'Read(**/*.pem)', 'Bash(sudo *)'],
          ask: ['Bash(git push *)', 'Bash(gh pr create:*)', 'mcp__x__y']
        }
      })
    );
    const config = join(dir, 'config.toml');
    writeFileSync(config, '');
    const first = run('--config', config, '--claude-settings', claude);
    expect(first.json.profileBlock).toContain('"~/.ssh/id_*" = "deny"');
    expect(first.json.profileBlock).toContain('"**/*.pem" = "deny"');
    expect(first.json.profileBlock).not.toContain('sudo');
    expect(first.json.rulesBlock).toContain('pattern = ["git", "push"],');
    expect(first.json.rulesBlock).toContain('pattern = ["gh", "pr", "create"],');
    expect(first.json.rulesBlock).not.toContain('mcp__x__y');
    writeFileSync(config, 'default_permissions = "mine"\n');
    const rules = join(dir, 'default.rules');
    writeFileSync(rules, 'prefix_rule(pattern = ["git", "push"], decision = "prompt")\n');
    const second = run('--config', config, '--claude-settings', claude, '--rules', rules);
    expect(second.json.profileBlock).toBe('');
    expect(second.json.rulesBlock).toBe('');
  });

  test('a user config that does not parse is reported, never a crash', () => {
    const dir = scratch();
    const config = join(dir, 'config.toml');
    writeFileSync(config, 'model = [\n');
    const { code, json } = run('--config', config, '--claude-settings', join(dir, 'none.json'));
    expect(code).toBe(0);
    expect(json.status).toBe('unreadable');
    expect(typeof json.unreadable).toBe('string');
  });

  test('a current config with the profile and rules in place reports nothing to paste, and --out writes the note', () => {
    const dir = scratch();
    const config = join(dir, 'config.toml');
    writeFileSync(
      config,
      'default_permissions = "mine"\napproval_policy = "on-request"\napprovals_reviewer = "user"\ncheck_for_update_on_startup = true\n\n[analytics]\nenabled = false\n\n[feedback]\nenabled = false\n\n[otel]\nexporter = "none"\nmetrics_exporter = "none"\ntrace_exporter = "none"\nlog_user_prompt = false\n\n[tui]\nanimations = false\nalternate_screen = "never"\n'
    );
    const rules = join(dir, 'default.rules');
    writeFileSync(rules, '# mine\n');
    const out = join(dir, 'updates', 'codex-user-config.md');
    const { json } = run(
      '--config',
      config,
      '--claude-settings',
      join(dir, 'none.json'),
      '--rules',
      rules,
      '--out',
      out
    );
    expect(json.status).toBe('current');
    expect(json.missing).toEqual([]);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf-8')).toContain('Keys: current');
    expect(readFileSync(config, 'utf-8')).not.toContain('auto_review');
  });
});
