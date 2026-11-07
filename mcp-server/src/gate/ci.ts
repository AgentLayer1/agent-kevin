import { isInside } from '@/shared/paths';
import { readTextIfExists } from '@/shared/text';
import { resolve } from 'node:path';
import { z } from 'zod';
import { type PostgresSettings, postgresSchema } from './settings';

const literal = z.union([z.string(), z.number(), z.boolean()]);
const workflowSchema = z.object({
  env: z.record(z.string(), literal).optional(),
  jobs: z.record(
    z.string(),
    z.object({
      env: z.record(z.string(), literal).optional(),
      services: z
        .record(z.string(), z.object({ image: z.string(), env: z.record(z.string(), literal).optional() }))
        .optional()
    })
  )
});

/** Only the official image: it runs in Docker outside the sandbox, so the repo doesn't get to pick it. */
const OFFICIAL_POSTGRES = /^postgres:[\w.-]+$/;

/**
 * The placeholder env and the Postgres service a repo's CI job declares, so the gate runs with what CI runs.
 * Values that are `${{ … }}` expressions (secrets, matrix values) are left out.
 */
export const readCiDefaults = (
  checkout: string,
  { workflow, job }: { workflow: string; job?: string }
): { env: Record<string, string>; postgres?: PostgresSettings } => {
  const file = resolve(checkout, workflow);
  if (!isInside(file, checkout)) {
    throw new Error(`The gate settings' ci.workflow "${workflow}" points outside ${checkout}.`);
  }
  const text = readTextIfExists(file);
  if (!text) {
    throw new Error(`The gate settings name the CI workflow ${workflow}, but ${file} doesn't exist.`);
  }
  const parsed = workflowSchema.safeParse(Bun.YAML.parse(text));
  if (!parsed.success) {
    throw new Error(`${file} doesn't look like a GitHub Actions workflow: ${parsed.error.issues[0]?.message ?? ''}`);
  }
  const jobs = Object.entries(parsed.data.jobs);
  const picked = job
    ? jobs.find(([name]) => name === job)
    : jobs.length === 1
      ? jobs[0]
      : jobs.find(([, spec]) => spec.services?.postgres);
  if (!picked) {
    throw new Error(`Pick a job in the gate settings' ci.job: ${file} has ${jobs.map(([name]) => name).join(', ')}.`);
  }
  const [, spec] = picked;

  const env = Object.fromEntries(
    Object.entries({ ...parsed.data.env, ...spec.env }).flatMap(([name, value]) =>
      String(value).includes('${{') ? [] : [[name, String(value)]]
    )
  );
  const service = spec.services?.postgres;
  if (!service) {
    return { env };
  }
  if (!OFFICIAL_POSTGRES.test(service.image)) {
    throw new Error(
      `${file}'s postgres service uses ${service.image}; the gate starts only official postgres:<tag> images.`
    );
  }
  const serviceEnv = service.env ?? {};
  if (!serviceEnv.POSTGRES_PASSWORD) {
    throw new Error(`${file}'s postgres service sets no POSTGRES_PASSWORD, which the official image needs.`);
  }
  const user = String(serviceEnv.POSTGRES_USER ?? 'postgres');
  const urlEnv = Object.keys(env).filter((name) => /^postgres(ql)?:\/\//.test(env[name] ?? ''));
  return {
    env,
    postgres: postgresSchema.parse({
      image: service.image,
      user,
      password: String(serviceEnv.POSTGRES_PASSWORD),
      database: String(serviceEnv.POSTGRES_DB ?? user),
      urlEnv: urlEnv.length ? urlEnv : ['DATABASE_URL']
    })
  };
};
