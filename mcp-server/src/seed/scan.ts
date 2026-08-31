/**
 * seed_scan — read-only detection of what THIS home could seed a teammate with.
 *
 * Feeds the /seed-export interview: every category comes back with enough
 * detail (template-identical vs diverged, referenced env keys, pack labels)
 * for the operator to tick items, and nothing here writes or stages anything.
 * Secret VALUES are never read — the store is deny-gated and this module only
 * ever surfaces key NAMES from non-secret files.
 */
import { FILES, FOLDERS } from '@/config';
import { classifyGrant, CREDENTIAL_KEY_RE, type GrantClass, PACKS, sha256 } from '@/seed/format';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface FileCandidate {
  path: string;
  /** True when a template counterpart exists with identical bytes — the recipient's own init already provides it. */
  templateIdentical: boolean;
}

interface ProjectCandidate {
  slug: string;
  readme: boolean;
  roadmap: boolean;
}

interface McpServerCandidate {
  name: string;
  /** Env key names the server entry references (`$KEY`) — planted as empty placeholders on import. */
  envKeys: string[];
  entry: unknown;
}

interface ClassifiedGrant {
  entry: string;
  class: GrantClass;
}

interface ActivePack {
  name: string;
  /** Secret key NAMES the pack needs — forwarded to the bundle's `secretKeys` when the pack is carried. */
  secretKeys: string[];
  /** Non-secret key NAMES — forwarded to the bundle's `settingsEnv`. */
  settingsEnv: string[];
}

export interface SeedScanResult {
  agentName: string;
  templateAgentName: string;
  identity: { identityDiverged: boolean; soulDiverged: boolean; avatars: string[] };
  concepts: FileCandidate[];
  projects: ProjectCandidate[];
  rootRoadmap: boolean;
  customSkills: string[];
  /** Symlinked skill installs (skills.sh) — not exportable; the recipient reinstalls from the registry. */
  thirdPartySkills: string[];
  rules: FileCandidate[];
  mcpServers: McpServerCandidate[];
  /** Packs whose full grant set is present in permissions.allow, with the key names they carry. */
  activePacks: ActivePack[];
  permissions: { allow: ClassifiedGrant[]; ask: ClassifiedGrant[] };
  /** Key NAMES in settings.local.json `env` (values omitted — they're machine-specific). */
  settingsEnvKeys: string[];
}

const fileHash = (path: string): string | null => (existsSync(path) ? sha256(readFileSync(path)) : null);

const sameAsTemplate = (homePath: string, templatePath: string): boolean => {
  const home = fileHash(homePath);
  return home !== null && home === fileHash(templatePath);
};

const parseAgentName = (identityPath: string): string => {
  if (!existsSync(identityPath)) return '';
  const match = readFileSync(identityPath, 'utf-8').match(/^\s*-\s*\*\*Name:\*\*\s*(.+?)\s*$/m);
  return match?.[1] ?? '';
};

const readJson = (path: string): Record<string, unknown> | null => {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const listMarkdown = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.md'))
        .sort()
    : [];

/** Env keys a server entry references, minus path/infra vars that must stay machine-local. */
const INFRA_KEY_RE = /(_HOME|_PATH|^PATH|^PWD|^TMPDIR|^HOME)$/;

const referencedEnvKeys = (entry: unknown): string[] => {
  const keys = new Set<string>();
  for (const match of JSON.stringify(entry).matchAll(/\$([A-Z][A-Z0-9_]{2,})/g)) {
    const key = match[1];
    if (!INFRA_KEY_RE.test(key)) keys.add(key);
  }
  return [...keys].sort();
};

export const scanSeed = (): SeedScanResult => {
  const home = FOLDERS.HOME;
  const templates = FOLDERS.TEMPLATES;

  const assetsDir = resolve(home, '.claude', 'assets');
  const avatars = existsSync(assetsDir)
    ? readdirSync(assetsDir)
        .filter((name) => !name.startsWith('.'))
        .sort()
    : [];

  const concepts: FileCandidate[] = listMarkdown(FOLDERS.CONCEPTS).map((name) => ({
    path: `knowledge/concepts/${name}`,
    templateIdentical: sameAsTemplate(join(FOLDERS.CONCEPTS, name), join(templates, 'knowledge', 'concepts', name))
  }));

  const projects: ProjectCandidate[] = existsSync(FOLDERS.PROJECTS)
    ? readdirSync(FOLDERS.PROJECTS, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.') && dirent.name !== 'archive')
        .map((dirent) => ({
          slug: dirent.name,
          readme: existsSync(join(FOLDERS.PROJECTS, dirent.name, 'README.md')),
          roadmap: existsSync(join(FOLDERS.PROJECTS, dirent.name, 'roadmap.html'))
        }))
        .sort((left, right) => left.slug.localeCompare(right.slug))
    : [];

  const skillsDir = resolve(home, '.claude', 'skills');
  const customSkills: string[] = [];
  const thirdPartySkills: string[] = [];
  if (existsSync(skillsDir)) {
    for (const name of readdirSync(skillsDir).sort()) {
      if (name.startsWith('.')) continue;
      (lstatSync(join(skillsDir, name)).isSymbolicLink() ? thirdPartySkills : customSkills).push(name);
    }
  }

  const rulesDir = resolve(home, '.claude', 'rules');
  const rules: FileCandidate[] = listMarkdown(rulesDir).map((name) => ({
    path: `.claude/rules/${name}`,
    templateIdentical: sameAsTemplate(join(rulesDir, name), join(templates, 'rules', name))
  }));

  const mcpConfig = readJson(resolve(home, '.mcp.json'));
  const servers = (mcpConfig?.mcpServers ?? {}) as Record<string, unknown>;
  const mcpServers: McpServerCandidate[] = Object.entries(servers)
    .map(([name, entry]) => ({ name, envKeys: referencedEnvKeys(entry), entry }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const settings = readJson(resolve(home, '.claude', 'settings.json'));
  const permissionsRaw = (settings?.permissions ?? {}) as { allow?: string[]; ask?: string[] };
  const classify = (entries: string[] | undefined): ClassifiedGrant[] =>
    (entries ?? []).map((entry) => ({ entry, class: classifyGrant(entry) }));
  const allow = classify(permissionsRaw.allow);
  const activePacks = Object.entries(PACKS)
    .filter(([, def]) => def.grants.every((grant) => permissionsRaw.allow?.includes(grant)))
    .map(([name, def]) => ({ name, secretKeys: def.secretKeys, settingsEnv: def.settingsEnv }));

  const localSettings = readJson(resolve(home, '.claude', 'settings.local.json'));
  // Credential-shaped keys (some homes keep e.g. an OAuth token in the env block on
  // purpose) are never offered to a bundle — see CREDENTIAL_KEY_RE.
  const settingsEnvKeys = Object.keys((localSettings?.env ?? {}) as Record<string, unknown>)
    .filter((key) => !CREDENTIAL_KEY_RE.test(key))
    .sort();

  return {
    agentName: parseAgentName(FILES.IDENTITY),
    templateAgentName: parseAgentName(join(templates, 'IDENTITY.md')),
    identity: {
      identityDiverged: !sameAsTemplate(FILES.IDENTITY, join(templates, 'IDENTITY.md')),
      soulDiverged: !sameAsTemplate(FILES.SOUL, join(templates, 'SOUL.md')),
      avatars
    },
    concepts,
    projects,
    rootRoadmap: existsSync(FILES.ROADMAP),
    customSkills,
    thirdPartySkills,
    rules,
    mcpServers,
    activePacks,
    permissions: { allow, ask: classify(permissionsRaw.ask) },
    settingsEnvKeys
  };
};
