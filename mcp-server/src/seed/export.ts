/**
 * seed_export — build a seed bundle zip from an approved selection.
 *
 * The /seed-export skill runs the interview + per-file review gate and only
 * then calls this with the approved include list; this module is mechanical.
 * It validates every path against the format's allowed roots (a bad selection
 * fails loud, it is never silently dropped), stages payload + manifest into a
 * temp dir, and shells out to `zip`. Read-only against the home.
 */
import { FOLDERS, KNOWLEDGE } from '@/config';
import { CREDENTIAL_KEY_RE, type SeedFileEntry, type SeedManifest, sha256, validateSeedPath } from '@/seed/format';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface SeedExportOptions {
  /** Home-relative paths to include — files, or directories expanded recursively (e.g. `.claude/skills/acme-logs`). */
  include: string[];
  /** Display name the bundle carries — the skill reads it off IDENTITY.md during the interview. */
  agentName: string;
  /** Skill-authored content written into the bundle (e.g. the CLAUDE.md overlay section). */
  extras?: { path: string; content: string }[];
  permissions?: { allow?: string[]; ask?: string[] };
  secretKeys?: string[];
  settingsEnv?: string[];
  mcpServers?: Record<string, unknown>;
  /** Absolute output path for the zip. Defaults to `<HOME>/reports/seeds/<date>-<slug>-seed.zip`. */
  out?: string;
}

export interface SeedExportResult {
  bundlePath: string;
  manifest: SeedManifest;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'agent';

/** Expand an include entry to concrete home-relative file paths. */
const expandInclude = (home: string, path: string): string[] => {
  const absolute = resolve(home, path);
  if (!existsSync(absolute)) throw new Error(`include path does not exist: ${path}`);
  if (!statSync(absolute).isDirectory()) return [path];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((dirent) => dirent.isFile() && !KNOWLEDGE.IGNORED_FILES.has(dirent.name))
    .map((dirent) =>
      join(dirent.parentPath, dirent.name)
        .slice(home.length + 1)
        .replaceAll('\\', '/')
    )
    .sort();
};

const ensureZipAvailable = (): void => {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
  } catch {
    // TODO(windows): Git Bash ships unzip but usually not zip — no shim, fail loud.
    throw new Error('`zip` CLI not found on PATH — seed export needs it (bundled with macOS/Linux).');
  }
};

export const exportSeed = (options: SeedExportOptions): SeedExportResult => {
  const home = FOLDERS.HOME;
  ensureZipAvailable();

  const paths = [...new Set(options.include.flatMap((entry) => expandInclude(home, entry)))];
  const extras = options.extras ?? [];
  const errors = [...paths, ...extras.map((extra) => extra.path)]
    .map((path) => validateSeedPath(path))
    .filter((error): error is string => error !== null);
  for (const key of options.settingsEnv ?? []) {
    if (CREDENTIAL_KEY_RE.test(key)) {
      errors.push(`credential-shaped key in settingsEnv: ${key} — a needed credential travels as a secretKeys NAME`);
    }
  }
  if (errors.length > 0) throw new Error(`seed export refused:\n${errors.join('\n')}`);

  const staging = mkdtempSync(join(tmpdir(), 'seed-export-'));
  try {
    const files: SeedFileEntry[] = [];
    for (const path of paths) {
      const destination = join(staging, 'files', path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(resolve(home, path), destination);
      files.push({ path, hash: sha256(readFileSync(destination)) });
    }
    for (const extra of extras) {
      const destination = join(staging, 'files', extra.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, extra.content);
      files.push({ path: extra.path, hash: sha256(Buffer.from(extra.content)), generated: true });
    }

    const manifest: SeedManifest = {
      formatVersion: 1,
      agentName: options.agentName,
      createdAt: new Date().toISOString(),
      files,
      ...(options.permissions ? { permissions: options.permissions } : {}),
      ...(options.secretKeys?.length ? { secretKeys: [...options.secretKeys].sort() } : {}),
      ...(options.settingsEnv?.length ? { settingsEnv: [...options.settingsEnv].sort() } : {}),
      ...(options.mcpServers && Object.keys(options.mcpServers).length ? { mcpServers: options.mcpServers } : {})
    };
    writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const bundlePath = resolve(
      options.out ??
        join(
          FOLDERS.REPORTS,
          'seeds',
          `${new Date().toISOString().slice(0, 10)}-${slugify(options.agentName)}-seed.zip`
        )
    );
    mkdirSync(dirname(bundlePath), { recursive: true });
    rmSync(bundlePath, { force: true });
    execFileSync('zip', ['-r', '-q', bundlePath, 'manifest.json', 'files'], { cwd: staging });

    return { bundlePath, manifest };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
};
