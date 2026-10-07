import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  LEGACY_RUNTIME_DIR,
  RUNTIME_DIR,
  agentEnvPrefix,
  agentKeyName,
  dataDirOf,
  ownDataDir,
  pluginName
} from './naming';

describe('agentEnvPrefix', () => {
  // The fork seam, asserted in one place — every other test builds key names
  // from the prefix and the runtime dir from the constant, so a fork updates
  // these lines and nothing else.
  test('derives KEVIN_ from this plugin manifest (agent-kevin)', () => {
    expect(agentEnvPrefix()).toBe('KEVIN_');
    expect(agentKeyName('CODE_PATH')).toBe('KEVIN_CODE_PATH');
  });

  test("this agent's data dir is .state, moved from .kevin", () => {
    expect(RUNTIME_DIR).toBe('.state');
    expect(LEGACY_RUNTIME_DIR).toBe('.kevin');
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

  test('a legacy dir counts recorded or not, but never when it records another plugin', () => {
    const legacyHome = homeWith({ [LEGACY_RUNTIME_DIR]: unrecorded });
    expect(ownDataDir(legacyHome)).toBe(resolve(legacyHome, LEGACY_RUNTIME_DIR));
    expect(ownDataDir(homeWith({ [LEGACY_RUNTIME_DIR]: ours }))).toBeDefined();
    expect(ownDataDir(homeWith({ [LEGACY_RUNTIME_DIR]: other }))).toBeUndefined();
  });

  test('.state wins over a legacy dir left beside it', () => {
    const home = homeWith({ [RUNTIME_DIR]: ours, [LEGACY_RUNTIME_DIR]: unrecorded });
    expect(ownDataDir(home)).toBe(resolve(home, RUNTIME_DIR));
  });

  test('a home not yet moved keeps its legacy dir even beside a foreign .state', () => {
    const home = homeWith({ [RUNTIME_DIR]: other, [LEGACY_RUNTIME_DIR]: unrecorded });
    expect(dataDirOf(home)).toBe(resolve(home, LEGACY_RUNTIME_DIR));
  });

  test('a home with no data dir yet writes to .state', () => {
    const home = homeWith({});
    expect(ownDataDir(home)).toBeUndefined();
    expect(dataDirOf(home)).toBe(resolve(home, RUNTIME_DIR));
  });
});
