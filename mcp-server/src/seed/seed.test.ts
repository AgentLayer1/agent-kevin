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
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pluginName, RUNTIME_DIR } from '@/shared/naming';
import { HOME_PLACEHOLDER, validateSeedPath } from '@/seed/format';
import { renameAgent } from '@/shared/agent-name';
import { scanSeed } from '@/seed/scan';
import { exportSeed } from '@/seed/export';
import { importSeed } from '@/seed/import';
import { AGENT_SLUG, PLUGIN_NAME } from '@/config';

const TEMPLATES = resolve(import.meta.dir, '..', '..', '..', 'templates');

const sha256 = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const makeHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'seed-home-'));
  mkdirSync(join(home, RUNTIME_DIR), { recursive: true });
  writeFileSync(join(home, RUNTIME_DIR, 'version.json'), `${JSON.stringify({ plugin: pluginName() })}\n`);
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
  write(sourceHome, 'assets/avatar.jpg', 'jpegbytes');
  write(sourceHome, 'scripts/browser/acme-login/index.ts', 'export {};\n');
  write(sourceHome, 'scripts/browser/acme-login/.env', 'ACME_PASSWORD=hunter2\n');
  write(sourceHome, 'scripts/browser/acme-login/.env.example', 'ACME_PASSWORD=\n');
  write(sourceHome, 'scripts/acme-report.ts', 'export {};\n');
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
            `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__ping`,
            `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__web_search`,
            `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__browser_screenshot`,
            `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__browser_pdf`,
            `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__browser_markdown`,
            `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__browser_record`,
            `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__browser_flows`,
            `Skill(${PLUGIN_NAME}:sync)`
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
  // Best-effort: the command sandbox denies **/.state/secrets paths, so homes that
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
    expect(validateSeedPath('AGENTS.md')).toBeNull();
    expect(validateSeedPath('knowledge/concepts/x.md')).toBeNull();
    expect(validateSeedPath('projects/acme/README.md')).toBeNull();
    expect(validateSeedPath('projects/acme/helpdesk.md')).toBeNull();
    expect(validateSeedPath('.claude/skills/acme-logs/SKILL.md')).toBeNull();
    expect(validateSeedPath('scripts/browser/acme-login/index.ts')).toBeNull();
  });

  test('refuses a credential file under any root', () => {
    expect(validateSeedPath('scripts/browser/acme-login/.env')).toMatch(/credential file/);
    expect(validateSeedPath('.claude/skills/acme-logs/.env.local')).toMatch(/credential file/);
    expect(validateSeedPath('scripts/browser/acme-login/.ENV')).toMatch(/credential file/);
    expect(validateSeedPath('scripts/browser/acme-login/.envrc')).toMatch(/credential file/);
    expect(validateSeedPath('scripts/browser/acme-login/.env.example')).toBeNull();
    expect(validateSeedPath('scripts/acme-sync/.env')).toMatch(/credential file/);
    expect(validateSeedPath('scripts/acme-report.ts')).toBeNull();
  });

  test("refuses a flow under a built-in flow's name", () => {
    expect(validateSeedPath('scripts/browser/hacker-news/index.ts')).toMatch(/built-in flow/);
  });

  test('refuses traversal, absolutes, and private material', () => {
    expect(validateSeedPath('../evil.md')).not.toBeNull();
    expect(validateSeedPath('knowledge/concepts/../../USER.md')).not.toBeNull();
    expect(validateSeedPath('/etc/passwd')).not.toBeNull();
    expect(validateSeedPath('USER.md')).not.toBeNull();
    // The manual's alternate location (init collision case) — compile reads it with
    // priority, so a seeded copy would shadow the real manual.
    expect(validateSeedPath('CLAUDE.local.md')).not.toBeNull();
    // The manual is AGENTS.md; a root CLAUDE.md is a project's own file or the Claude Code bridge's old spot.
    expect(validateSeedPath('CLAUDE.md')).not.toBeNull();
    expect(validateSeedPath('.claude/CLAUDE.md')).not.toBeNull();
    expect(validateSeedPath('knowledge/memory/index.md')).not.toBeNull();
    expect(validateSeedPath(`${RUNTIME_DIR}/secrets/.env`)).not.toBeNull();
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
    expect(scan.projects).toEqual([{ slug: 'acme', readme: true, roadmap: true, helpdesk: false }]);
    expect(scan.rootRoadmap).toBe(true);
    expect(scan.customSkills).toEqual(['acme-logs']);
    expect(scan.customFlows).toEqual(['acme-login']);
    expect(scan.customScripts).toEqual(['acme-report.ts']);
    expect(scan.rules.map((r) => r.path)).toContain('.claude/rules/acme.md');
    expect(scan.mcpServers).toHaveLength(1);
    expect(scan.mcpServers[0]?.name).toBe('acme-telemetry');
    expect(scan.mcpServers[0]?.envKeys).toEqual(['MCP_ACME_TELEMETRY_TOKEN']);
    expect(scan.activePacks).toEqual([
      { name: 'browser', denies: [], secretKeys: ['PERPLEXITY_API_KEY'], settingsEnv: [] }
    ]);
    expect(scan.settingsEnvKeys).toEqual(['GSC_SITE_URL']);
    const classes = new Map(scan.permissions.allow.map((grant) => [grant.entry, grant.class]));
    expect(classes.get('Bash(ls *)')).toBe('core');
    expect(classes.get(`mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__web_search`)).toEqual({ pack: 'browser' });
    expect(classes.get('Bash(curl https://acme.example/*)')).toBe('custom');
    expect(classes.get(`Skill(${PLUGIN_NAME}:sync)`)).toBe('skill');
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
          'assets/avatar.jpg'
        ],
        agentName: 'Scout',
        extras: [{ path: 'AGENTS.md', content: '## Team conventions\n\nShip > start.\n' }],
        permissions: {
          allow: [
            `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__web_search`,
            `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__browser_screenshot`,
            'Bash(curl https://acme.example/*)',
            `Skill(${PLUGIN_NAME}:seed-export)`
          ],
          deny: ['Bash(acme *)']
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
    expect(paths).toContain('AGENTS.md');
    expect(result.manifest.secretKeys).toEqual(['MCP_ACME_TELEMETRY_TOKEN', 'PERPLEXITY_API_KEY']);
  });
});

describe('importSeed', () => {
  const bundle = (): string => join(sourceHome, 'bundle.zip');

  test('dry run reports the plan without writing', () => {
    const recipient = makeHome();
    homes.push(recipient);
    write(recipient, 'SOUL.md', '# Soul\n\nStock scaffold, different from the seed.\n');
    write(recipient, 'AGENTS.md', '# Local manual\n');

    const plan = inHome(recipient, () => importSeed({ bundlePath: bundle(), dryRun: true }));
    expect(plan.dryRun).toBe(true);
    expect(plan.conflicts).toEqual(['SOUL.md']);
    expect(plan.appended).toEqual(['AGENTS.md']);
    expect(plan.written).toContain('IDENTITY.md');
    expect(plan.secretKeysToFill).toEqual(['MCP_ACME_TELEMETRY_TOKEN', 'PERPLEXITY_API_KEY']);
    expect(existsSync(join(recipient, 'IDENTITY.md'))).toBe(false);
    expect(readFileSync(join(recipient, 'AGENTS.md'), 'utf-8')).toBe('# Local manual\n');
    expect(existsSync(join(recipient, '.claude', 'settings.json'))).toBe(false);
  });

  test('applies with overwrite, merges setup, and is idempotent', () => {
    const recipient = makeHome();
    homes.push(recipient);
    write(recipient, 'SOUL.md', '# Soul\n\nStock scaffold.\n');
    write(recipient, 'AGENTS.md', '# Local manual\n');
    write(
      recipient,
      '.claude/settings.json',
      JSON.stringify(
        { permissions: { allow: ['Bash(ls *)', `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__web_search`] } },
        null,
        2
      )
    );

    const result = inHome(recipient, () => importSeed({ bundlePath: bundle(), overwrite: true }));
    expect(result.agentName).toBe('Scout');
    expect(result.audience).toBe('teammate');
    expect(result.conflicts).toEqual([]);
    expect(result.written).toContain('SOUL.md');
    expect(readFileSync(join(recipient, 'IDENTITY.md'), 'utf-8')).toContain('Scout');
    expect(readFileSync(join(recipient, 'AGENTS.md'), 'utf-8')).toContain('Ship > start.');
    expect(readFileSync(join(recipient, '.claude/skills/acme-logs/SKILL.md'), 'utf-8')).toContain('acme-logs');
    expect(readFileSync(join(recipient, 'assets/avatar.jpg'), 'utf-8')).toBe('jpegbytes');

    const settings = JSON.parse(readFileSync(join(recipient, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.permissions.allow).toContain(`mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__browser_screenshot`);
    expect(settings.permissions.allow).toContain('Bash(curl https://acme.example/*)');
    expect(result.permissionsAdded.allow).not.toContain(`mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__web_search`);
    // A grant for a skill retired since the bundle was made lands as its successor's.
    expect(settings.permissions.allow).toContain(`Skill(${PLUGIN_NAME}:seed)`);
    expect(settings.permissions.allow).not.toContain(`Skill(${PLUGIN_NAME}:seed-export)`);
    expect(settings.permissions.deny).toEqual(['Bash(acme *)']);
    expect(result.permissionsAdded.deny).toEqual(['Bash(acme *)']);

    const mcp = JSON.parse(readFileSync(join(recipient, '.mcp.json'), 'utf-8'));
    expect(Object.keys(mcp.mcpServers)).toEqual(['acme-telemetry']);

    const local = JSON.parse(readFileSync(join(recipient, '.claude', 'settings.local.json'), 'utf-8'));
    expect(local.env.GSC_SITE_URL).toBe('');
    expect(existsSync(join(recipient, RUNTIME_DIR, 'secrets', '.env'))).toBe(true);

    const again = inHome(recipient, () => importSeed({ bundlePath: bundle(), overwrite: true }));
    expect(again.written).toEqual([]);
    expect(again.conflicts).toEqual([]);
    expect(again.permissionsAdded.allow).toEqual([]);
    expect(again.permissionsAdded.deny).toEqual([]);
    expect(again.mcpServersSkipped).toEqual(['acme-telemetry']);
    // Fully idempotent: the overlay section is already in the manual, so no re-append.
    expect(again.appended).toEqual([]);
    expect(again.unchanged).toContain('AGENTS.md');
  });

  test('refuses a hostile manifest before any write', () => {
    const evil = mkdtempSync(join(tmpdir(), 'seed-evil-'));
    homes.push(evil);
    const payload = 'owned\n';
    mkdirSync(join(evil, 'files', RUNTIME_DIR, 'secrets'), { recursive: true });
    writeFileSync(join(evil, 'files', RUNTIME_DIR, 'secrets', '.env'), payload);
    writeFileSync(
      join(evil, 'manifest.json'),
      JSON.stringify({
        formatVersion: 1,
        agentName: 'Mallory',
        createdAt: '2026-01-01T00:00:00Z',
        files: [{ path: `${RUNTIME_DIR}/secrets/.env`, hash: sha256(Buffer.from(payload)) }]
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

describe('manual overlay', () => {
  test("lands in AGENTS.md and never in the operator's own root CLAUDE.md", () => {
    const recipient = makeHome();
    homes.push(recipient);
    write(recipient, 'CLAUDE.md', '# My project notes\n');

    inHome(recipient, () => importSeed({ bundlePath: join(sourceHome, 'bundle.zip'), overwrite: true }));
    expect(readFileSync(join(recipient, 'AGENTS.md'), 'utf-8')).toContain('Ship > start.');
    expect(readFileSync(join(recipient, 'CLAUDE.md'), 'utf-8')).toBe('# My project notes\n');
  });
});

describe('browser flows in a bundle', () => {
  test("a flow's .env stays behind and its .env.example travels", () => {
    const result = asSource(() =>
      exportSeed({
        include: ['scripts/browser/acme-login'],
        agentName: 'Scout',
        out: join(sourceHome, 'flows.zip')
      })
    );
    const paths = result.manifest.files.map((file) => file.path);
    expect(result.skippedEnvFiles).toEqual(['scripts/browser/acme-login/.env']);
    expect(paths).toContain('scripts/browser/acme-login/index.ts');
    expect(paths).toContain('scripts/browser/acme-login/.env.example');
    expect(paths).not.toContain('scripts/browser/acme-login/.env');
  });

  test('refuses a credential file named outright', () => {
    expect(() =>
      asSource(() => exportSeed({ include: ['scripts/browser/acme-login/.env'], agentName: 'Scout' }))
    ).toThrow(/credential file never travels/);
  });
});

describe('a bundle under a new name', () => {
  test('swaps whole words only', () => {
    expect(renameAgent("Scout's notes. Scouting is not Scout-Bot.", 'Scout', 'Ranger')).toBe(
      "Ranger's notes. Scouting is not Scout-Bot."
    );
    expect(renameAgent('Scout here', 'Scout', "$&$'")).toBe("$&$' here");
  });

  test('an extras override ships in place of the home copy of the same path', () => {
    const result = asSource(() =>
      exportSeed({
        include: ['IDENTITY.md'],
        agentName: 'Ranger',
        extras: [{ path: 'IDENTITY.md', content: '- **Name:** Ranger\n' }],
        out: join(sourceHome, 'override.zip')
      })
    );
    expect(result.manifest.files.map((file) => file.path)).toEqual(['IDENTITY.md']);
    const recipient = makeHome();
    homes.push(recipient);
    inHome(recipient, () => importSeed({ bundlePath: result.bundlePath, overwrite: true }));
    expect(readFileSync(join(recipient, 'IDENTITY.md'), 'utf-8')).toBe('- **Name:** Ranger\n');
  });

  test("renames the bundled identity and leaves the home's copy alone", () => {
    const result = asSource(() =>
      exportSeed({ include: ['IDENTITY.md', 'SOUL.md'], agentName: 'Ranger', out: join(sourceHome, 'renamed.zip') })
    );
    expect(result.renamed).toEqual(['IDENTITY.md']);
    expect(readFileSync(join(sourceHome, 'IDENTITY.md'), 'utf-8')).toContain('- **Name:** Scout');

    const recipient = makeHome();
    homes.push(recipient);
    inHome(recipient, () => importSeed({ bundlePath: result.bundlePath, overwrite: true }));
    expect(readFileSync(join(recipient, 'IDENTITY.md'), 'utf-8')).toContain('- **Name:** Ranger');
  });

  test("leaves the source agent's former names out of the bundle", () => {
    const identity = '# Identity\n\n## Who\n\n- **Name:** Scout\n- **Kind:** AI assistant\n';
    write(sourceHome, 'IDENTITY.md', identity.replace('Scout\n', 'Scout\n- **Formerly:** Pathfinder\n'));
    try {
      const result = asSource(() =>
        exportSeed({ include: ['IDENTITY.md'], agentName: 'Scout', out: join(sourceHome, 'formerly.zip') })
      );
      const recipient = makeHome();
      homes.push(recipient);
      inHome(recipient, () => importSeed({ bundlePath: result.bundlePath, overwrite: true }));
      expect(readFileSync(join(recipient, 'IDENTITY.md'), 'utf-8')).toBe(identity);
    } finally {
      write(sourceHome, 'IDENTITY.md', identity);
    }
  });
});

describe('project pins in a bundle', () => {
  test("a project README travels without its Pinned section, since what it pins doesn't", () => {
    write(sourceHome, 'projects/beta/README.md', '# Beta\n\n## Pinned\n\n- [Plan](../../reports/plan.md)\n\n## Code\n\nrepo\n');
    const result = asSource(() =>
      exportSeed({ include: ['projects/beta/README.md'], agentName: 'Scout', out: join(sourceHome, 'pins.zip') })
    );
    const recipient = makeHome();
    homes.push(recipient);
    inHome(recipient, () => importSeed({ bundlePath: result.bundlePath, overwrite: true }));
    expect(readFileSync(join(recipient, 'projects/beta/README.md'), 'utf-8')).toBe('# Beta\n\n## Code\n\nrepo\n');
    expect(readFileSync(join(sourceHome, 'projects/beta/README.md'), 'utf-8')).toContain('## Pinned');
  });
});

describe('queue profiles in a bundle', () => {
  test("a project's helpdesk queue profile is scanned and travels as written", () => {
    const profile = '---\nstatuses: [Open]\ncadence: weekly\n---\n\n## Triage\n\n- Ask for the app version first\n';
    write(sourceHome, 'projects/gamma/README.md', '# Gamma\n');
    write(sourceHome, 'projects/gamma/helpdesk.md', profile);
    expect(asSource(() => scanSeed()).projects.find((project) => project.slug === 'gamma')).toEqual({
      slug: 'gamma',
      readme: true,
      roadmap: false,
      helpdesk: true
    });
    const result = asSource(() =>
      exportSeed({ include: ['projects/gamma/helpdesk.md'], agentName: 'Scout', out: join(sourceHome, 'queue.zip') })
    );
    const recipient = makeHome();
    homes.push(recipient);
    inHome(recipient, () => importSeed({ bundlePath: result.bundlePath, overwrite: true }));
    expect(readFileSync(join(recipient, 'projects/gamma/helpdesk.md'), 'utf-8')).toBe(profile);
  });
});

describe('the bundle audience', () => {
  test('export records it and import passes it on', () => {
    const result = asSource(() =>
      exportSeed({ include: ['IDENTITY.md'], agentName: 'Scout', audience: 'self', out: join(sourceHome, 'self.zip') })
    );
    expect(result.manifest.audience).toBe('self');

    const recipient = makeHome();
    homes.push(recipient);
    const plan = inHome(recipient, () => importSeed({ bundlePath: result.bundlePath, dryRun: true }));
    expect(plan.audience).toBe('self');
  });
});

describe('home paths in carried MCP entries', () => {
  const secretsFile = (home: string): string => `. "${home}/${RUNTIME_DIR}/secrets/.env"`;

  test("export swaps this home's path for the placeholder and import fills in its own", () => {
    const result = asSource(() =>
      exportSeed({
        include: ['IDENTITY.md'],
        agentName: 'Scout',
        mcpServers: { 'acme-logs': { command: 'sh', args: ['-c', secretsFile(sourceHome)] } },
        out: join(sourceHome, 'retarget.zip')
      })
    );
    expect(JSON.stringify(result.manifest.mcpServers)).not.toContain(sourceHome);
    expect(JSON.stringify(result.manifest.mcpServers)).toContain(HOME_PLACEHOLDER);

    const recipient = makeHome();
    homes.push(recipient);
    inHome(recipient, () => importSeed({ bundlePath: result.bundlePath }));
    const mcp = JSON.parse(readFileSync(join(recipient, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers['acme-logs'].args[1]).toBe(secretsFile(recipient));
  });

  test('a $HOME-relative spelling of the home is swapped too', () => {
    const previous = process.env.HOME;
    process.env.HOME = dirname(sourceHome);
    try {
      const result = asSource(() =>
        exportSeed({
          include: ['IDENTITY.md'],
          agentName: 'Scout',
          mcpServers: { 'acme-logs': { command: 'sh', args: ['-c', `d="$HOME/${basename(sourceHome)}"`] } },
          out: join(sourceHome, 'relative.zip')
        })
      );
      expect(JSON.stringify(result.manifest.mcpServers)).toContain(`d=\\"${HOME_PLACEHOLDER}\\"`);
    } finally {
      process.env.HOME = previous;
    }
  });
});

describe('scanSeed with the GitHub pack', () => {
  test("carries the pack's gh denies with it", () => {
    const home = makeHome();
    homes.push(home);
    const github = [
      'fast_forward', 'pr_list', 'pr_view', 'pr_comments', 'pr_diff', 'pr_checks', 'run_list', 'run_view', 'run_log',
      'issue_list', 'issue_view', 'issue_create', 'issue_comment', 'issue_update', 'pr_update'
    ].map((tool) => `mcp__plugin_${PLUGIN_NAME}_${AGENT_SLUG}__github_${tool}`);
    write(home, '.claude/settings.json', JSON.stringify({ permissions: { allow: github, deny: ['Bash(gh)', 'Bash(gh *)'] } }));
    const scan = inHome(home, () => scanSeed());
    expect(scan.activePacks.find((pack) => pack.name === 'github')?.denies).toEqual(['Bash(gh)', 'Bash(gh *)']);
  });
});
