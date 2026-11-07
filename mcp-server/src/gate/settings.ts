import { FOLDERS } from '@/config';
import { readTextIfExists } from '@/shared/text';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { z } from 'zod';

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

const settingsSchema = z
  .object({
    env: z.record(z.string().regex(ENV_NAME), z.string()).default({}),
    postgres: z
      .object({
        image: z.string().regex(/^[\w./-]+(:[\w.-]+)?$/),
        user: z.string().regex(/^\w+$/),
        password: z.string().regex(/^\w+$/),
        database: z.string().regex(/^\w+$/),
        urlEnv: z.array(z.string().regex(ENV_NAME)).min(1)
      })
      .strict()
      .optional(),
    writable: z.array(z.string()).default([])
  })
  .strict();

export type GateSettings = z.infer<typeof settingsSchema>;
export type PostgresSettings = NonNullable<GateSettings['postgres']>;

/**
 * The gate settings for a configured repo, from `<HOME>/scripts/gate/<repo folder>.json`, shared by its sibling
 * worktrees. No file means no extras. `writable` resolves to absolute paths and must stay under `~/.cache/`.
 */
export const readGateSettings = (repoFolder: string): GateSettings => {
  const file = gateSettingsFile(repoFolder);
  const text = readTextIfExists(file);
  if (!text.trim()) {
    return { env: {}, writable: [] };
  }
  const parsed = settingsSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(
      `${file} is not valid gate settings: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`
    );
  }
  return { ...parsed.data, writable: parsed.data.writable.map((path) => cachePath(path, file)) };
};

export const gateSettingsFile = (repoFolder: string): string => join(FOLDERS.SCRIPTS, 'gate', `${repoFolder}.json`);

const cachePath = (path: string, file: string): string => {
  const absolute = normalize(path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
  const cache = join(homedir(), '.cache');
  const inside = relative(cache, absolute);
  if (!isAbsolute(absolute) || !inside || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(
      `${file}: writable "${path}" must be a folder under ~/.cache/ (a tool's cache), not ${resolve(absolute)}.`
    );
  }
  return absolute;
};
