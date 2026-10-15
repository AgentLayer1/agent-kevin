import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { RUNTIME_DIR, dataDirOf, legacyEnvPrefix, ownDataDir, pluginName } from './naming';

describe('legacyEnvPrefix', () => {
  // The fork seam, asserted in one place — every other test builds legacy key names
  // from the prefix and the runtime dir from the constant, so a fork updates
  // these lines and nothing else.
  test('derives KEVIN_ from this plugin manifest (agent-kevin)', () => {
    expect(legacyEnvPrefix()).toBe('KEVIN_');
  });

  test("this agent's data dir is .state", () => {
    expect(RUNTIME_DIR).toBe('.state');
  });
});

describe('ownDataDir', () => {
  const homes: string[] = [];
  const homeWith = (dirs: Record<string, string>): string => {
    const home = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-datadir-')));
    homes.push(home);
    Object.entries(dirs).forEach(([dir, versionJson]) => {
      mkdirSync(resolve(home, dir), { recursive: true });
      writeFileSync(resolve(home, dir, 'version.json'), versionJson);
    });
    return home;
  };
  const ours = JSON.stringify({ plugin: pluginName() });
  const other = JSON.stringify({ plugin: 'agent-other' });
  const unrecorded = JSON.stringify({ templateVersion: '0.6.4' });
  afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

  test('a .state recording this plugin is the data dir', () => {
    const home = homeWith({ [RUNTIME_DIR]: ours });
    expect(ownDataDir(home)).toBe(resolve(home, RUNTIME_DIR));
  });

  // The shared name proves nothing on its own: any agent or tool could have made it.
  test("an unrecorded or foreign .state is never this agent's", () => {
    expect(ownDataDir(homeWith({ [RUNTIME_DIR]: unrecorded }))).toBeUndefined();
    expect(ownDataDir(homeWith({ [RUNTIME_DIR]: other }))).toBeUndefined();
  });

  test('a home with no data dir yet writes to .state', () => {
    const home = homeWith({});
    expect(ownDataDir(home)).toBeUndefined();
    expect(dataDirOf(home)).toBe(resolve(home, RUNTIME_DIR));
  });
});
