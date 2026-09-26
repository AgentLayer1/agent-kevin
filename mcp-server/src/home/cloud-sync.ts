import { resolveEnv } from '@/shared/naming';
import { isInside } from '@/shared/paths';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Which cloud service syncs a path, or `null` when it stays on this computer. */
export type SyncedBy = string | null;

/** Nearest existing ancestor, realpath'd, so a not-yet-created target is judged by where it would land. */
const resolveExisting = (path: string): string => {
  let current = resolve(path);
  while (!existsSync(current) && dirname(current) !== current) {
    current = dirname(current);
  }
  try {
    return realpathSync(current);
  } catch {
    return current;
  }
};

// A folder macOS won't let us inspect (Desktop under privacy protection) counts as synced: the
// cost of a wrong "synced" is only that history lives outside the folder, which works anywhere.
const hasFileProviderXattr = (dir: string): boolean => {
  try {
    execFileSync('xattr', ['-p', 'com.apple.file-provider-domain-id', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String(err.stderr) : '';
    return !stderr.includes('No such xattr');
  }
};

const macSyncedBy = (path: string, userHome: string): SyncedBy => {
  const cloudStorage = join(userHome, 'Library', 'CloudStorage');
  if (isInside(path, join(userHome, 'Library', 'Mobile Documents'))) {
    return 'iCloud Drive';
  }
  if (isInside(path, cloudStorage)) {
    const provider = relative(cloudStorage, path).split(sep)[0] ?? '';
    return provider.split('-')[0] || 'a cloud drive';
  }
  // The older Dropbox client syncs ~/Dropbox directly and marks nothing.
  if (isInside(path, join(userHome, 'Dropbox'))) {
    return 'Dropbox';
  }
  // iCloud "Desktop & Documents" and other file providers mark the synced root, not each child.
  const ancestors: string[] = [];
  // Every ancestor up to the root: a sync root can live outside the user's home (an external drive).
  for (let dir = path; dirname(dir) !== dir; dir = dirname(dir)) {
    ancestors.push(dir);
  }
  // Root-first: the marker sits on the synced root, so a synced home stops at the first spawn.
  return ancestors.reverse().some(hasFileProviderXattr) ? 'iCloud Drive' : null;
};

const namesIn = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/**
 * OneDrive publishes its folders in the environment (personal and work accounts alike, wherever
 * they were moved), and names them `OneDrive…` under the user's home by default.
 */
const windowsSyncedBy = (path: string, userHome: string): SyncedBy => {
  const oneDriveRoots = [
    resolveEnv('OneDrive'),
    resolveEnv('OneDriveConsumer'),
    resolveEnv('OneDriveCommercial'),
    ...namesIn(userHome)
      .filter((name) => name.startsWith('OneDrive'))
      .map((name) => join(userHome, name))
  ].filter((root): root is string => Boolean(root));
  if (oneDriveRoots.some((root) => isInside(path, resolveExisting(root)))) {
    return 'OneDrive';
  }
  // Google Drive for desktop streams to a drive letter's `My Drive` by default, or mirrors under the home.
  if (/^[A-Za-z]:[\\/](My Drive|Shared drives)([\\/]|$)/.test(path)) {
    return 'Google Drive';
  }
  return userFolderSyncedBy(path, userHome);
};

/** Default sync folders directly under a Windows user folder, whether reached natively or from WSL. */
const userFolderSyncedBy = (path: string, userHome: string): SyncedBy => {
  const folders: [string, string][] = [
    ['iCloudDrive', 'iCloud Drive'],
    ['Dropbox', 'Dropbox'],
    ['My Drive', 'Google Drive']
  ];
  return folders.find(([folder]) => isInside(path, join(userHome, folder)))?.[1] ?? null;
};

/** WSL reaches the Windows user folder at `/mnt/<drive>/Users/<name>`; its OneDrive folders sync. */
const linuxSyncedBy = (path: string, userHome: string): SyncedBy => {
  const windowsUser = /^\/mnt\/[a-z]\/Users\/[^/]+/i.exec(path)?.[0];
  if (windowsUser) {
    const folder = relative(windowsUser, path).split(sep)[0] ?? '';
    return folder.startsWith('OneDrive') ? 'OneDrive' : userFolderSyncedBy(path, windowsUser);
  }
  return isInside(path, join(userHome, 'Dropbox')) ? 'Dropbox' : null;
};

/**
 * Detect whether a path sits in a cloud-synced folder. macOS checks the iCloud and File Provider
 * locations plus the file-provider xattr on each ancestor; Windows asks OneDrive where its folders
 * are and knows the iCloud, Dropbox and Google Drive defaults; Linux knows Dropbox's, and under WSL
 * the Windows user folder's.
 */
export const syncedBy = (path: string, userHome: string = homedir()): SyncedBy => {
  const real = resolveExisting(path);
  const home = resolveExisting(userHome);
  if (process.platform === 'darwin') {
    return macSyncedBy(real, home);
  }
  if (process.platform === 'win32') {
    return windowsSyncedBy(real, home);
  }
  // Judged on the path as given too: a WSL mount can be missing from where this runs.
  return linuxSyncedBy(real, home) ?? linuxSyncedBy(resolve(path), home);
};
