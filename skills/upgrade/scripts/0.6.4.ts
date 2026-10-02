#!/usr/bin/env bun
/**
 * Upgrade migration for v0.6.4: Codex homes move from `gpt-6-astra` to `gpt-6.1-sol`.
 *
 * The Codex wiring keeps a home-level `model` it finds, so a home that took the old default stays
 * on Astra. This rewrites a top-level `model = "gpt-6-astra"` in `<HOME>/.codex/config.toml` to
 * the new default, once; any other model, and every other line, is left as it is.
 *
 * Run by `/agent-kevin:upgrade` via `run_upgrade` (outside the Bash sandbox, which under Codex is
 * the only way to write `.codex/`). Idempotent.
 * Contract: prints a single-line JSON report as its LAST stdout line; exits non-zero on failure.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION = '0.6.4';
const RETIRED_MODEL = 'gpt-6-astra';
const MODEL = 'gpt-6.1-sol';

const HOME = resolve(process.env.KEVIN_HOME?.trim() || process.env.AGENT_HOME?.trim() || process.cwd());
const CONFIG = resolve(HOME, '.codex', 'config.toml');
// Top-level keys precede every table, so when the home's model is Astra this first match is it.
const RETIRED_LINE = /^(\s*model\s*=\s*)(["'])gpt-6-astra\2/m;

const modelOf = (text: string): unknown => (Bun.TOML.parse(text) as Record<string, unknown>).model;

const migrate = () => {
  if (!existsSync(CONFIG)) {
    return { action: 'no-codex-config' };
  }
  const text = readFileSync(CONFIG, 'utf-8');
  const model = modelOf(text);
  if (model !== RETIRED_MODEL) {
    return { action: 'kept', model };
  }
  const updated = text.replace(RETIRED_LINE, `$1$2${MODEL}$2`);
  if (modelOf(updated) !== MODEL) {
    throw new Error(
      `${CONFIG} sets model to ${RETIRED_MODEL} in a form this script does not rewrite; set model = "${MODEL}" by hand`
    );
  }
  writeFileSync(CONFIG, updated);
  return { action: 'switched', model: MODEL };
};

try {
  process.stdout.write(JSON.stringify({ ok: true, version: VERSION, config: CONFIG, ...migrate() }) + '\n');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
