/**
 * Loaded before every test file (see `bunfig.toml`).
 *
 * Pins `AGENT_HOME` to a throwaway tree so no suite can ever resolve to the operator's real
 * brain and write session captures, compile state, or reports into it. `config` resolves paths
 * live, so a suite that wants its own home just sets `AGENT_HOME` itself — this is the floor,
 * not a constraint. It exists because the failure mode it prevents is silent: a test that writes
 * real knowledge looks exactly like a passing test.
 *
 * Reads `process.env` directly rather than via `@/shared/env` because importing that module
 * self-loads the home's `secrets/.env` from whatever home is current — which is the thing this
 * file exists to pin first. `shared/naming.ts` is safe to import: side-effect-free, and it
 * owns the runtime-dir name this marks the home with, so the marker can't drift from the guards
 * (`isAgentHome`) that look for it.
 */
import { afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { RUNTIME_DIR_DEFAULT, agentKeyName } from './shared/naming';

// `mkdtemp`, never a fixed name: $TMPDIR is per-uid, so a stable path would be shared with any
// concurrent `bun test` run on this machine.
const home = mkdtempSync(resolve(tmpdir(), 'kevin-test-home-'));
mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT), { recursive: true });
process.env.AGENT_HOME = home;
// A <AGENT>_HOME inherited from the operator's shell is this agent's override
// prefix and would beat the pin above.
delete process.env[agentKeyName('HOME')];

// A preload-registered `afterAll` fires once for the whole run, not per file (verified), and
// `bun test` never runs `process.on('exit')` handlers — so this is the only hook that works here.
afterAll(() => rmSync(home, { recursive: true, force: true }));
