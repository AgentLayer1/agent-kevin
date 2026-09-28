import { mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { RUNTIME_DIR_DEFAULT } from './naming';

/**
 * True when a command sandbox denies reading secrets stores, so tests that round-trip a temp
 * home's secrets can skip instead of failing for a reason outside the code under test.
 */
export const secretsReadBlocked = (): boolean => {
  // A fixed path rather than mkdtemp: the sandbox also refuses to delete the probe, so every
  // run reuses the one empty directory instead of leaving a new one behind.
  const probe = resolve(tmpdir(), 'agent-secrets-probe', RUNTIME_DIR_DEFAULT, 'secrets');
  mkdirSync(probe, { recursive: true });
  try {
    readdirSync(probe);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};
