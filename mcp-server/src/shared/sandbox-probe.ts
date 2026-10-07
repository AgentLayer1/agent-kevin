import { mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { RUNTIME_DIR } from './naming';

/**
 * True when a command sandbox denies reading the secrets store under `dir`, so tests that
 * round-trip a temp home's secrets can skip instead of failing for a reason outside the code.
 */
export const secretsReadBlocked = (dir: string = RUNTIME_DIR): boolean => {
  // A fixed path rather than mkdtemp: the sandbox also refuses to delete the probe, so every
  // run reuses the one empty directory instead of leaving a new one behind.
  const probe = resolve(tmpdir(), 'agent-secrets-probe', dir, 'secrets');
  mkdirSync(probe, { recursive: true });
  try {
    readdirSync(probe);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};
