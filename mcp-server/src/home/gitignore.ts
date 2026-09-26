/**
 * The home's `.gitignore`, reconciled against the plugin template: every template rule the home
 * lacks is appended under `# agent-kevin`, and the operator's own lines are never removed or
 * reordered. Shared by init, upgrade (via `skills/init/scripts/home-baseline.ts`) and home history.
 * A leaf on purpose (node builtins and naming only), so skill scripts can import it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNTIME_DIR_DEFAULT } from '../shared/naming';

export interface GitignoreChange {
  created: boolean;
  rewritten: string[];
  added: string[];
}

/** The template's runtime folder and the one this home actually uses, when they differ. */
export interface RuntimeRename {
  from: string;
  to: string;
}

const withRuntimeDir = (template: string, rename?: RuntimeRename): string =>
  rename && rename.from !== rename.to
    ? template.replace(new RegExp(`^(!?)${rename.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'gm'), `$1${rename.to}/`)
    : template;

export const reconcileGitignore = (current: string, template: string, rename?: RuntimeRename) => {
  const templateRules = withRuntimeDir(template, rename)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  // Two git rules: the last matching pattern wins, so a negation must sit below the rule it
  // carves out of; and git can't re-include a file whose parent directory is excluded, so a
  // bare `dir/` must become the template's `dir/*`.
  const contentsRules = new Map(
    templateRules
      .filter((rule) => rule.endsWith('/*'))
      .flatMap((rule) => {
        const dir = rule.slice(0, -2);
        return [dir, `${dir}/`, `/${dir}`, `/${dir}/`].map((bare) => [bare, rule] as const);
      })
  );
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const original = current.split(/\r?\n/);
  const lines = original.map((line) => contentsRules.get(line.trim()) ?? line);
  const rewritten = original.map((line) => line.trim()).filter((line) => contentsRules.has(line));

  const homeRules = lines.map((line) => line.trim());
  const added = templateRules.reduce<string[]>((acc, rule, index) => {
    const present = [...homeRules, ...acc];
    const carvedFrom = rule.startsWith('!')
      ? templateRules.slice(0, index).findLast((above) => !above.startsWith('!'))
      : undefined;
    const effective = carvedFrom ? present.lastIndexOf(rule) > present.lastIndexOf(carvedFrom) : present.includes(rule);
    return effective ? acc : [...acc, rule];
  }, []);

  const body = lines.join(eol);
  const separated = body === '' ? '' : `${body.endsWith(eol) ? body : body + eol}${eol}`;
  const text = added.length === 0 ? body : `${separated}# agent-kevin${eol}${added.join(eol)}${eol}`;
  return { text, rewritten, added };
};

/**
 * Reconcile `<home>/.gitignore` with the template at `templatePath`; `write: false` is a dry run.
 * `runtimeDir` is the home's runtime folder, which replaces the template's when it was renamed.
 */
export const reconcileHomeGitignore = (
  home: string,
  templatePath: string,
  write: boolean,
  runtimeDir: string = RUNTIME_DIR_DEFAULT
): GitignoreChange => {
  const gitignorePath = join(home, '.gitignore');
  const template = withRuntimeDir(readFileSync(templatePath, 'utf-8'), { from: RUNTIME_DIR_DEFAULT, to: runtimeDir });
  const created = !existsSync(gitignorePath);
  const before = created ? '' : readFileSync(gitignorePath, 'utf-8');
  const gitignore = created ? { text: template, rewritten: [], added: [] } : reconcileGitignore(before, template);
  if (gitignore.text !== before && write) {
    writeFileSync(gitignorePath, gitignore.text);
  }
  return { created, rewritten: gitignore.rewritten, added: gitignore.added };
};
