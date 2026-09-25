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

  test('a plain local folder stays on this computer', () => {
    const local = join(userHome, 'Developer', 'ada-data.git');
    mkdirSync(local, { recursive: true });
    expect(syncedBy(local, userHome)).toBeNull();
  });
});
