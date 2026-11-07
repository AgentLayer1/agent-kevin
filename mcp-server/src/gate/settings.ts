import { FOLDERS } from '@/config';
import { expandTilde, isInside } from '@/shared/paths';
import { readTextIfExists } from '@/shared/text';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import { z } from 'zod';

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

export const postgresSchema = z
  .object({
    image: z.string().regex(/^[\w./-]+(:[\w.-]+)?$/),
    user: z.string().regex(/^\w+$/),
    password: z.string().regex(/^\w+$/),
    database: z.string().regex(/^\w+$/),
    urlEnv: z.array(z.string().regex(ENV_NAME)).min(1)
  })
  .strict();

const settingsSchema = z
  .object({
    /** The repo's CI workflow to read placeholder env and the Postgres service from. */
    ci: z.object({ workflow: z.string(), job: z.string().optional() }).strict().optional(),
    env: z.record(z.string().regex(ENV_NAME), z.string()).default({}),
    postgres: postgresSchema.optional(),
    /** The scripts that reach the database (and the selftest); without it, every script step does. */
    postgresSteps: z.array(z.string()).optional(),
    writable: z.array(z.string()).default([])
  })
  .strict();

export type GateSettings = z.infer<typeof settingsSchema>;
export type PostgresSettings = z.infer<typeof postgresSchema>;

/**
 * The gate settings for a configured repo, from `<HOME>/scripts/gate/<repo folder>.json`, shared by its sibling
 * worktrees. No file means no extras. `writable` resolves to absolute paths and must stay under `~/.cache/`.
 */
export const readGateSettings = (repoFolder: string): GateSettings => {
  const file = gateSettingsFile(repoFolder);
  const parsed = settingsSchema.safeParse(parseJson(readTextIfExists(file), file));
  if (!parsed.success) {
    throw new Error(
      `${file} is not valid gate settings: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`
    );
  }
  return { ...parsed.data, writable: parsed.data.writable.map((path) => cachePath(path, file)) };
};

export const gateSettingsFile = (repoFolder: string): string => join(FOLDERS.SCRIPTS, 'gate', `${repoFolder}.json`);

const parseJson = (text: string, file: string): unknown => {
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
};

const cachePath = (path: string, file: string): string => {
  const absolute = normalize(expandTilde(path));
  const cache = join(homedir(), '.cache');
  if (!isAbsolute(absolute) || absolute === cache || !isInside(absolute, cache)) {
    throw new Error(
      `${file}: writable "${path}" must be a folder under ~/.cache/ (a tool's cache), not ${resolve(absolute)}.`
    );
  }
  return absolute;
};
