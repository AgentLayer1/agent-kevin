/**
 * Keeps the gate engine byte-identical across sibling plugins, by copying (never symlinking).
 *
 *   bun scripts/sync-gate.ts                  re-hash this plugin's shared files into gate/shared.json
 *   bun scripts/sync-gate.ts --to <plugin>    and copy them, with shared.json, into the sibling plugin
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
const to = process.argv.includes('--to') ? resolve(process.argv[process.argv.indexOf('--to') + 1] ?? '') : undefined;

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

const manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')) as SharedManifest;
const missing = manifest.files.filter(({ path }) => !existsSync(join(root, path)));
if (missing.length) {
  throw new Error(`Listed in ${MANIFEST} but missing here: ${missing.map(({ path }) => path).join(', ')}`);
}

const rehashed: SharedManifest = {
  files: manifest.files.map(({ path }) => ({ path, sha256: sha256(join(root, path)) }))
};
writeFileSync(join(root, MANIFEST), `${JSON.stringify(rehashed, null, 2)}\n`);
const changedHere = rehashed.files.filter(
  ({ path, sha256: hash }) => manifest.files.find((file) => file.path === path)?.sha256 !== hash
);
console.log(
  changedHere.length ? `Re-hashed: ${changedHere.map(({ path }) => path).join(', ')}` : 'Hashes already current.'
);

if (to) {
  if (!existsSync(join(to, 'mcp-server', 'src'))) {
    throw new Error(`${to} is not a plugin checkout (no mcp-server/src).`);
  }
  const copied = rehashed.files.filter(
    ({ path, sha256: hash }) => !existsSync(join(to, path)) || sha256(join(to, path)) !== hash
  );
  copied.forEach(({ path }) => {
    mkdirSync(dirname(join(to, path)), { recursive: true });
    copyFileSync(join(root, path), join(to, path));
  });
  copyFileSync(join(root, MANIFEST), join(to, MANIFEST));
  console.log(
    copied.length ? `Copied to ${to}: ${copied.map(({ path }) => path).join(', ')}` : `${to} already matches.`
  );
}
