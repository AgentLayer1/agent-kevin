import { isInside } from '@/shared/paths';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
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
  // iCloud "Desktop & Documents" and other file providers mark the synced root, not each child.
  const ancestors: string[] = [];
  // Every ancestor up to the root: a sync root can live outside the user's home (an external drive).
  for (let dir = path; dirname(dir) !== dir; dir = dirname(dir)) {
    ancestors.push(dir);
  }
  // Root-first: the marker sits on the synced root, so a synced home stops at the first spawn.
  return ancestors.reverse().some(hasFileProviderXattr) ? 'iCloud Drive' : null;
};

/**
 * Detect whether a path sits in a cloud-synced folder. macOS checks the iCloud and File Provider
 * locations plus the file-provider xattr on each ancestor under the user's home; Linux knows
 * Dropbox's default folder; native Windows only knows OneDrive's default folder.
 */
export const syncedBy = (path: string, userHome: string = homedir()): SyncedBy => {
  const real = resolveExisting(path);
  const home = resolveExisting(userHome);
  if (process.platform === 'darwin') {
    return macSyncedBy(real, home);
  }
  if (process.platform === 'win32') {
    return isInside(real, join(home, 'OneDrive')) ? 'OneDrive' : null;
  }
  return isInside(real, join(home, 'Dropbox')) ? 'Dropbox' : null;
};
