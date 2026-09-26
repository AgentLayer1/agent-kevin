import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncedBy } from '@/home/cloud-sync';

const userHome = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-sync-')));

afterAll(() => {
  rmSync(userHome, { recursive: true, force: true });
});

describe.if(process.platform === 'darwin')('syncedBy on macOS', () => {
  test('names the File Provider service a CloudStorage folder belongs to', () => {
    const home = join(userHome, 'Library', 'CloudStorage', 'Dropbox-Acme', 'Agents', 'Ada');
    mkdirSync(home, { recursive: true });
    expect(syncedBy(home, userHome)).toBe('Dropbox');
  });

  test('treats iCloud Drive and a not-yet-created path inside it as synced', () => {
    const drive = join(userHome, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
    mkdirSync(drive, { recursive: true });
    expect(syncedBy(join(drive, 'Agents', 'Ada', 'history.git'), userHome)).toBe('iCloud Drive');
  });

  test('the older Dropbox client\'s ~/Dropbox counts as synced', () => {
    const home = join(userHome, 'Dropbox', 'Agents', 'Ada');
    mkdirSync(home, { recursive: true });
    expect(syncedBy(home, userHome)).toBe('Dropbox');
  });

  test('a plain local folder stays on this computer', () => {
    const local = join(userHome, 'Developer', 'ada-data.git');
    mkdirSync(local, { recursive: true });
    expect(syncedBy(local, userHome)).toBeNull();
  });
});

describe('syncedBy on Windows', () => {
  const asWindows = (run: () => void): void => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const saved = process.env.OneDrive;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      run();
    } finally {
      if (platform) {
        Object.defineProperty(process, 'platform', platform);
      }
      if (saved === undefined) {
        delete process.env.OneDrive;
      } else {
        process.env.OneDrive = saved;
      }
    }
  };

  test('finds a work OneDrive folder by name, and a moved one through its environment variable', () => {
    const work = join(userHome, 'OneDrive - Acme', 'Documents', 'Ada');
    const moved = join(userHome, 'elsewhere', 'SyncRoot', 'Ada');
    const local = join(userHome, 'Code', 'Ada');
    [work, moved, local].forEach((path) => mkdirSync(path, { recursive: true }));
    asWindows(() => {
      process.env.OneDrive = join(userHome, 'elsewhere', 'SyncRoot');
      expect(syncedBy(work, userHome)).toBe('OneDrive');
      expect(syncedBy(moved, userHome)).toBe('OneDrive');
      expect(syncedBy(local, userHome)).toBeNull();
    });
  });
});
