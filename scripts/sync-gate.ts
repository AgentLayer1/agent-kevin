/**
 * Keeps the gate engine byte-identical across sibling plugins, by copying (never symlinking).
 *
 *   bun scripts/sync-gate.ts                    re-hash this plugin's shared files into gate/shared.json
 *   bun scripts/sync-gate.ts --to <plugin>      and copy them, with shared.json, into the sibling plugin;
 *                                               nothing is copied while a file there was edited since its last sync
 *   bun scripts/sync-gate.ts --check <plugin>   report what differs, copying nothing
 *
 * The list of shared files is gate/shared.json's own; a file that isn't in it is the plugin's own layer.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

interface SharedManifest {
  files: { path: string; sha256: string }[];
}

const MANIFEST = join('mcp-server', 'src', 'gate', 'shared.json');
const root = resolve(import.meta.dir, '..');

const flagValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} needs the sibling plugin's path.`);
  }
  return resolve(value);
};

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');
const readManifest = (plugin: string): SharedManifest =>
  JSON.parse(readFileSync(join(plugin, MANIFEST), 'utf8')) as SharedManifest;
const hashIn = (manifest: SharedManifest, path: string): string | undefined =>
  manifest.files.find((file) => file.path === path)?.sha256;

const to = flagValue('--to');
const check = flagValue('--check');
const sibling = to ?? check;

const manifest = readManifest(root);
const missing = manifest.files.filter(({ path }) => !existsSync(join(root, path)));
if (missing.length) {
  throw new Error(`Listed in ${MANIFEST} but missing here: ${missing.map(({ path }) => path).join(', ')}`);
}
const rehashed: SharedManifest = {
  files: manifest.files.map(({ path }) => ({ path, sha256: sha256(join(root, path)) }))
};

if (!check) {
  writeFileSync(join(root, MANIFEST), `${JSON.stringify(rehashed, null, 2)}\n`);
  const changedHere = rehashed.files.filter(({ path, sha256: hash }) => hashIn(manifest, path) !== hash);
  console.log(
    changedHere.length ? `Re-hashed: ${changedHere.map(({ path }) => path).join(', ')}` : 'Hashes already current.'
  );
}

if (sibling) {
  if (!existsSync(join(sibling, MANIFEST))) {
    throw new Error(`${sibling} has no ${MANIFEST}, so it isn't a plugin that shares the gate.`);
  }
  const theirs = readManifest(sibling);
  const differing = rehashed.files.filter(
    ({ path, sha256: hash }) => !existsSync(join(sibling, path)) || sha256(join(sibling, path)) !== hash
  );
  const editedThere = differing.filter(
    ({ path }) => existsSync(join(sibling, path)) && sha256(join(sibling, path)) !== hashIn(theirs, path)
  );
  const orphans = theirs.files.filter(({ path }) => hashIn(rehashed, path) === undefined).map(({ path }) => path);

  if (check || editedThere.length) {
    console.log(
      differing.length
        ? `Differs in ${sibling}: ${differing.map(({ path }) => path).join(', ')}`
        : `${sibling} matches.`
    );
    if (editedThere.length) {
      console.log(
        `Edited in ${sibling} since its last sync, so nothing was copied: ${editedThere.map(({ path }) => path).join(', ')}. Port that edit here first.`
      );
    }
    if (orphans.length) {
      console.log(`Shared there but no longer here: ${orphans.join(', ')}`);
    }
    process.exitCode = differing.length || orphans.length ? 1 : 0;
  } else {
    differing.forEach(({ path }) => {
      mkdirSync(dirname(join(sibling, path)), { recursive: true });
      copyFileSync(join(root, path), join(sibling, path));
    });
    copyFileSync(join(root, MANIFEST), join(sibling, MANIFEST));
    console.log(
      differing.length
        ? `Copied to ${sibling}: ${differing.map(({ path }) => path).join(', ')}`
        : `${sibling} already matches.`
    );
    if (orphans.length) {
      console.log(`No longer shared, left in ${sibling} to remove or keep: ${orphans.join(', ')}`);
    }
  }
}
