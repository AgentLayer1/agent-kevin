/**
 * Seed round-trip: build a customized source home, scan → export → import into
 * a fresh recipient home, and verify fork semantics, merges, idempotence, and
 * the containment guarantees. Everything runs against mkdtemp homes (never
 * live data); the plugin's real templates/ dir is used for divergence checks.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { RUNTIME_DIR_DEFAULT } from '@/shared/naming';
import { validateSeedPath } from '@/seed/format';
import { scanSeed } from '@/seed/scan';
import { exportSeed } from '@/seed/export';
import { importSeed } from '@/seed/import';

const TEMPLATES = resolve(import.meta.dir, '..', '..', '..', 'templates');

const sha256 = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const makeHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'seed-home-'));
  mkdirSync(join(home, RUNTIME_DIR_DEFAULT), { recursive: true });
  writeFileSync(join(home, RUNTIME_DIR_DEFAULT, 'version.json'), '{}\n');
  return home;
};

const write = (home: string, path: string, content: string): void => {
  mkdirSync(join(home, ...path.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(home, path), content);
};

const homes: string[] = [];
let sourceHome: string;

beforeAll(() => {
  sourceHome = makeHome();
  homes.push(sourceHome);

  write(sourceHome, 'IDENTITY.md', '# Identity\n\n## Who\n\n- **Name:** Scout\n- **Kind:** AI assistant\n');
  write(sourceHome, 'SOUL.md', '# Soul\n\nCustomized for the acme team.\n');
  write(sourceHome, 'USER.md', '# About Priya\n\nPrivate.\n');
  write(sourceHome, 'roadmap.html', '<html>north star</html>\n');
  write(sourceHome, 'knowledge/concepts/acme-pattern.md', '# Acme pattern\n\nShared insight.\n');
  // Template-identical concept: the recipient's own init already seeds it, so scan flags it.
  write(
    sourceHome,
    'knowledge/concepts/karpathy-wiki.md',
    readFileSync(join(TEMPLATES, 'knowledge', 'concepts', 'karpathy-wiki.md'), 'utf-8')
  );
  write(sourceHome, 'projects/acme/README.md', '# Acme project\n');
  write(sourceHome, 'projects/acme/roadmap.html', '<html>acme plan</html>\n');
  write(sourceHome, 'projects/acme/tasks/ac-001-private.md', 'never travels\n');
  write(sourceHome, '.claude/skills/acme-logs/SKILL.md', '---\nname: acme-logs\n---\n# Acme logs\n');
  write(sourceHome, '.claude/rules/acme.md', '# Acme rule\n');
  write(sourceHome, '.claude/assets/avatar.jpg', 'jpegbytes');
  write(
    sourceHome,
    '.mcp.json',
    JSON.stringify(
      {
        mcpServers: {
          'acme-telemetry': { command: 'sh', args: ['-c', 'test -n "$MCP_ACME_TELEMETRY_TOKEN" && run "$AGENT_HOME"'] }
        }
      },
      null,
      2
    )
  );
  write(
    sourceHome,
    '.claude/settings.json',
    JSON.stringify(
      {
        permissions: {
          allow: [
            'Bash(ls *)',
            'Bash(curl https://acme.example/*)',
            'mcp__plugin_agent-kevin_kevin__ping',
            'mcp__plugin_agent-kevin_kevin__web_search',
            'mcp__plugin_agent-kevin_kevin__browser_screenshot',
            'mcp__plugin_agent-kevin_kevin__browser_pdf',
            'mcp__plugin_agent-kevin_kevin__browser_markdown',
            'mcp__plugin_agent-kevin_kevin__browser_record',
            'mcp__plugin_agent-kevin_kevin__browser_flows',
            'Skill(agent-kevin:sync)'
          ],
          ask: ['Bash(git push *)']
        }
      },
      null,
      2
    )
  );
  write(
    sourceHome,
    '.claude/settings.local.json',
    JSON.stringify({ env: { GSC_SITE_URL: 'https://acme.example/', CLAUDE_CODE_OAUTH_TOKEN: 'sk-live' } }, null, 2)
  );
});

afterAll(() => {
  // Best-effort: the command sandbox denies **/.kevin/secrets paths, so homes that
  // gained a secrets store can't be fully removed from inside a sandboxed test run.
  for (const home of homes) {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // leave the temp home to the OS
    }
  }
});

const asSource = <T>(fn: () => T): T => {
  const previous = process.env.AGENT_HOME;
  process.env.AGENT_HOME = sourceHome;
  try {
    return fn();
  } finally {
    process.env.AGENT_HOME = previous;
  }
};

const inHome = <T>(home: string, fn: () => T): T => {
  const previous = process.env.AGENT_HOME;
  process.env.AGENT_HOME = home;
  try {
    return fn();
  } finally {
    process.env.AGENT_HOME = previous;
  }
};

describe('validateSeedPath', () => {
  test('accepts the allowed roots', () => {
    expect(validateSeedPath('IDENTITY.md')).toBeNull();
    expect(validateSeedPath('knowledge/concepts/x.md')).toBeNull();
    expect(validateSeedPath('projects/acme/README.md')).toBeNull();
    expect(validateSeedPath('.claude/skills/acme-logs/SKILL.md')).toBeNull();
  });

  test('refuses traversal, absolutes, and private material', () => {
    expect(validateSeedPath('../evil.md')).not.toBeNull();
    expect(validateSeedPath('knowledge/concepts/../../USER.md')).not.toBeNull();
    expect(validateSeedPath('/etc/passwd')).not.toBeNull();
    expect(validateSeedPath('USER.md')).not.toBeNull();
    expect(validateSeedPath('CLAUDE.md')).not.toBeNull();
    expect(validateSeedPath('knowledge/memory/index.md')).not.toBeNull();
    expect(validateSeedPath('.kevin/secrets/.env')).not.toBeNull();
    expect(validateSeedPath('.claude/settings.json')).not.toBeNull();
    expect(validateSeedPath('projects/acme/tasks/ac-001-private.md')).not.toBeNull();
    expect(validateSeedPath('projects/TASKS.md')).not.toBeNull();
  });
});

describe('scanSeed', () => {
  test('detects the diverged setup', () => {
    const scan = asSource(() => scanSeed());
    expect(scan.agentName).toBe('Scout');
    expect(scan.identity.identityDiverged).toBe(true);
    expect(scan.identity.avatars).toEqual(['avatar.jpg']);
    const concepts = new Map(scan.concepts.map((concept) => [concept.path, concept.templateIdentical]));
    expect(concepts.get('knowledge/concepts/acme-pattern.md')).toBe(false);
    expect(concepts.get('knowledge/concepts/karpathy-wiki.md')).toBe(true);
    expect(scan.projects).toEqual([{ slug: 'acme', readme: true, roadmap: true }]);
    expect(scan.rootRoadmap).toBe(true);
    expect(scan.customSkills).toEqual(['acme-logs']);
    expect(scan.rules.map((r) => r.path)).toContain('.claude/rules/acme.md');
    expect(scan.mcpServers).toHaveLength(1);
    expect(scan.mcpServers[0]?.name).toBe('acme-telemetry');
    expect(scan.mcpServers[0]?.envKeys).toEqual(['MCP_ACME_TELEMETRY_TOKEN']);
    expect(scan.activePacks).toEqual([{ name: 'browser', secretKeys: ['PERPLEXITY_API_KEY'], settingsEnv: [] }]);
    expect(scan.settingsEnvKeys).toEqual(['GSC_SITE_URL']);
    const classes = new Map(scan.permissions.allow.map((grant) => [grant.entry, grant.class]));
    expect(classes.get('Bash(ls *)')).toBe('core');
    expect(classes.get('mcp__plugin_agent-kevin_kevin__web_search')).toEqual({ pack: 'browser' });
    expect(classes.get('Bash(curl https://acme.example/*)')).toBe('custom');
    expect(classes.get('Skill(agent-kevin:sync)')).toBe('skill');
  });
});

describe('exportSeed', () => {
  test('refuses credential-shaped settingsEnv keys', () => {
    expect(() =>
      asSource(() =>
        exportSeed({ include: ['IDENTITY.md'], agentName: 'Scout', settingsEnv: ['CLAUDE_CODE_OAUTH_TOKEN'] })
      )
    ).toThrow(/credential-shaped/);
  });

  test('refuses paths outside the allowed roots', () => {
    expect(() => asSource(() => exportSeed({ include: ['USER.md'], agentName: 'Scout' }))).toThrow(
      /allowed seed roots/
    );
    expect(() =>
      asSource(() => exportSeed({ include: ['projects/acme/tasks/ac-001-private.md'], agentName: 'Scout' }))
    ).toThrow(/never tasks/);
  });

  test('builds a bundle with expanded dirs, extras, and setup fields', () => {
    const result = asSource(() =>
      exportSeed({
        include: [
          'IDENTITY.md',
          'SOUL.md',
          'roadmap.html',
          'knowledge/concepts/acme-pattern.md',
          'projects/acme/README.md',
          'projects/acme/roadmap.html',
          '.claude/skills/acme-logs',
          '.claude/rules/acme.md',
          '.claude/assets/avatar.jpg'
        ],
        agentName: 'Scout',
        extras: [{ path: 'CLAUDE.local.md', content: '## Team conventions\n\nShip > start.\n' }],
        permissions: {
          allow: [
            'mcp__plugin_agent-kevin_kevin__web_search',
            'mcp__plugin_agent-kevin_kevin__browser_screenshot',
            'Bash(curl https://acme.example/*)'
          ]
        },
        secretKeys: ['PERPLEXITY_API_KEY', 'MCP_ACME_TELEMETRY_TOKEN'],
        settingsEnv: ['GSC_SITE_URL'],
        mcpServers: {
          'acme-telemetry': { command: 'sh', args: ['-c', 'test -n "$MCP_ACME_TELEMETRY_TOKEN" && run "$AGENT_HOME"'] }
        },
        out: join(sourceHome, 'bundle.zip')
      })
    );
    expect(existsSync(result.bundlePath)).toBe(true);
    const paths = result.manifest.files.map((file) => file.path);
    expect(paths).toContain('.claude/skills/acme-logs/SKILL.md');
    expect(paths).toContain('CLAUDE.local.md');
    expect(result.manifest.secretKeys).toEqual(['MCP_ACME_TELEMETRY_TOKEN', 'PERPLEXITY_API_KEY']);
  });
});

describe('importSeed', () => {
  const bundle = (): string => join(sourceHome, 'bundle.zip');

  test('dry run reports the plan without writing', () => {
    const recipient = makeHome();
    homes.push(recipient);
    write(recipient, 'SOUL.md', '# Soul\n\nStock scaffold, different from the seed.\n');
    write(recipient, 'CLAUDE.local.md', '# Local manual\n');

    const plan = inHome(recipient, () => importSeed({ bundlePath: bundle(), dryRun: true }));
    expect(plan.dryRun).toBe(true);
    expect(plan.conflicts).toEqual(['SOUL.md']);
    expect(plan.appended).toEqual(['CLAUDE.local.md']);
    expect(plan.written).toContain('IDENTITY.md');
    expect(plan.secretKeysToFill).toEqual(['MCP_ACME_TELEMETRY_TOKEN', 'PERPLEXITY_API_KEY']);
    expect(existsSync(join(recipient, 'IDENTITY.md'))).toBe(false);
    expect(readFileSync(join(recipient, 'CLAUDE.local.md'), 'utf-8')).toBe('# Local manual\n');
    expect(existsSync(join(recipient, '.claude', 'settings.json'))).toBe(false);
  });

  test('applies with overwrite, merges setup, and is idempotent', () => {
    const recipient = makeHome();
    homes.push(recipient);
    write(recipient, 'SOUL.md', '# Soul\n\nStock scaffold.\n');
    write(recipient, 'CLAUDE.local.md', '# Local manual\n');
    write(
      recipient,
      '.claude/settings.json',
      JSON.stringify({ permissions: { allow: ['Bash(ls *)', 'mcp__plugin_agent-kevin_kevin__web_search'] } }, null, 2)
    );

    const result = inHome(recipient, () => importSeed({ bundlePath: bundle(), overwrite: true }));
    expect(result.agentName).toBe('Scout');
    expect(result.conflicts).toEqual([]);
    expect(result.written).toContain('SOUL.md');
    expect(readFileSync(join(recipient, 'IDENTITY.md'), 'utf-8')).toContain('Scout');
    expect(readFileSync(join(recipient, 'CLAUDE.local.md'), 'utf-8')).toContain('Ship > start.');
    expect(readFileSync(join(recipient, '.claude/skills/acme-logs/SKILL.md'), 'utf-8')).toContain('acme-logs');

    const settings = JSON.parse(readFileSync(join(recipient, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.permissions.allow).toContain('mcp__plugin_agent-kevin_kevin__browser_screenshot');
    expect(settings.permissions.allow).toContain('Bash(curl https://acme.example/*)');
    expect(result.permissionsAdded.allow).not.toContain('mcp__plugin_agent-kevin_kevin__web_search');

    const mcp = JSON.parse(readFileSync(join(recipient, '.mcp.json'), 'utf-8'));
    expect(Object.keys(mcp.mcpServers)).toEqual(['acme-telemetry']);

    const local = JSON.parse(readFileSync(join(recipient, '.claude', 'settings.local.json'), 'utf-8'));
    expect(local.env.GSC_SITE_URL).toBe('');
    expect(existsSync(join(recipient, RUNTIME_DIR_DEFAULT, 'secrets', '.env'))).toBe(true);

    const again = inHome(recipient, () => importSeed({ bundlePath: bundle(), overwrite: true }));
    expect(again.written).toEqual([]);
    expect(again.conflicts).toEqual([]);
    expect(again.permissionsAdded.allow).toEqual([]);
    expect(again.mcpServersSkipped).toEqual(['acme-telemetry']);
    // The one non-idempotent surface by design: the overlay appends on every run.
    expect(again.appended).toEqual(['CLAUDE.local.md']);
  });

  test('refuses a hostile manifest before any write', () => {
    const evil = mkdtempSync(join(tmpdir(), 'seed-evil-'));
    homes.push(evil);
    const payload = 'owned\n';
    mkdirSync(join(evil, 'files', '.kevin', 'secrets'), { recursive: true });
    writeFileSync(join(evil, 'files', '.kevin', 'secrets', '.env'), payload);
    writeFileSync(
      join(evil, 'manifest.json'),
      JSON.stringify({
        formatVersion: 1,
        agentName: 'Mallory',
        createdAt: '2026-01-01T00:00:00Z',
        files: [{ path: '.kevin/secrets/.env', hash: sha256(Buffer.from(payload)) }]
      })
    );
    const evilZip = join(evil, 'evil.zip');
    execFileSync('zip', ['-r', '-q', evilZip, 'manifest.json', 'files'], { cwd: evil });

    const recipient = makeHome();
    homes.push(recipient);
    expect(() => inHome(recipient, () => importSeed({ bundlePath: evilZip }))).toThrow(/allowed seed roots/);
  });

  test('accepts a minimal thin bundle (the website-wizard producer)', () => {
    const thin = mkdtempSync(join(tmpdir(), 'seed-thin-'));
    homes.push(thin);
    const identity = '# Identity\n\n- **Name:** agent-acme\n';
    const soul = '# Soul\n\nSharp and useful. Loyal to Acme.\n';
    mkdirSync(join(thin, 'files'), { recursive: true });
    writeFileSync(join(thin, 'files', 'IDENTITY.md'), identity);
    writeFileSync(join(thin, 'files', 'SOUL.md'), soul);
    writeFileSync(
      join(thin, 'manifest.json'),
      JSON.stringify({
        formatVersion: 1,
        agentName: 'agent-acme',
        createdAt: '2026-01-01T00:00:00Z',
        files: [
          { path: 'IDENTITY.md', hash: sha256(Buffer.from(identity)) },
          { path: 'SOUL.md', hash: sha256(Buffer.from(soul)) }
        ]
      })
    );
    const thinZip = join(thin, 'thin.zip');
    execFileSync('zip', ['-r', '-q', thinZip, 'manifest.json', 'files'], { cwd: thin });

    const recipient = makeHome();
    homes.push(recipient);
    const result = inHome(recipient, () => importSeed({ bundlePath: thinZip }));
    expect(result.written.sort()).toEqual(['IDENTITY.md', 'SOUL.md']);
    expect(readFileSync(join(recipient, 'IDENTITY.md'), 'utf-8')).toContain('agent-acme');
  });

  test('refuses a symlink payload', () => {
    const sneaky = mkdtempSync(join(tmpdir(), 'seed-symlink-'));
    homes.push(sneaky);
    mkdirSync(join(sneaky, 'files'), { recursive: true });
    symlinkSync('/etc/hosts', join(sneaky, 'files', 'SOUL.md'));
    writeFileSync(
      join(sneaky, 'manifest.json'),
      JSON.stringify({
        formatVersion: 1,
        agentName: 'x',
        createdAt: '2026-01-01T00:00:00Z',
        files: [{ path: 'SOUL.md', hash: 'sha256:0000' }]
      })
    );
    const sneakyZip = join(sneaky, 'sneaky.zip');
    execFileSync('zip', ['-r', '-q', '-y', sneakyZip, 'manifest.json', 'files'], { cwd: sneaky });

    const recipient = makeHome();
    homes.push(recipient);
    expect(() => inHome(recipient, () => importSeed({ bundlePath: sneakyZip }))).toThrow(/not a regular file/);
  });

  test('refuses a corrupt payload (hash mismatch)', () => {
    const corrupt = mkdtempSync(join(tmpdir(), 'seed-corrupt-'));
    homes.push(corrupt);
    mkdirSync(join(corrupt, 'files'), { recursive: true });
    writeFileSync(join(corrupt, 'files', 'SOUL.md'), 'tampered\n');
    writeFileSync(
      join(corrupt, 'manifest.json'),
      JSON.stringify({
        formatVersion: 1,
        agentName: 'x',
        createdAt: '2026-01-01T00:00:00Z',
        files: [{ path: 'SOUL.md', hash: 'sha256:0000' }]
      })
    );
    const corruptZip = join(corrupt, 'corrupt.zip');
    execFileSync('zip', ['-r', '-q', corruptZip, 'manifest.json', 'files'], { cwd: corrupt });

    const recipient = makeHome();
    homes.push(recipient);
    expect(() => inHome(recipient, () => importSeed({ bundlePath: corruptZip }))).toThrow(/hash mismatch/);
  });
});
