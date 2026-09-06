#!/usr/bin/env bun
/**
 * The recommended user-global auto-mode block, generated from the init skill's
 * printed JSON (the source of truth) with `<HOME_DIR>` substituted — so no skill
 * has to transcribe a two-kilobyte rule by hand. `--check` compares the operator's
 * `~/.claude/settings.json` rule by rule (matched by the rule's name, judged by
 * exact text) and lists what needs replacing, down to the sentences that changed.
 * `--out` writes a readable note the operator can open after the session.
 * Print-only: this never writes the operator's settings.
 *
 * Usage: automode-block.ts --home <dir> [--check] [--out <file>] [--settings <file>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const home = flag('home');
if (!home) {
  process.stderr.write('usage: automode-block.ts --home <dir> [--check] [--out <file>] [--settings <file>]\n');
  process.exit(2);
}

const skill = readFileSync(resolve(import.meta.dir, '..', 'SKILL.md'), 'utf-8');
const heading = skill.indexOf('### Offer the auto-mode knowledge-base exception');
const fence = skill.indexOf('```json\n', heading);
const close = skill.indexOf('\n```', fence + 8);
if (heading === -1 || fence === -1 || close === -1) {
  throw new Error('init SKILL.md no longer carries the auto-mode JSON block where this script expects it');
}
interface AutoModeBlock {
  permissions?: { defaultMode?: string };
  autoMode: { environment: string[]; allow: string[]; soft_deny: string[] };
}
const canonical = JSON.parse(
  skill
    .slice(fence + 8, close)
    .split('<HOME_DIR>')
    .join(home)
) as AutoModeBlock;

const settingsPath = flag('settings') ?? resolve(homedir(), '.claude', 'settings.json');
const settings = existsSync(settingsPath)
  ? (JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      permissions?: { defaultMode?: string };
      autoMode?: Partial<Record<'allow' | 'soft_deny', string[]>>;
    })
  : {};
const mine = settings.autoMode ?? {};

// A rule is identified by its leading name ("Agent Knowledge Base: …", "Identity File
// Replacement [named+specifics — …]: …") and judged by its full text. `environment` is
// left alone on purpose: operators extend it per home, so it has no canonical text.
const ruleName = (rule: string): string => rule.split(/[:[]/)[0].trim();
const sentences = (text: string): string[] => text.split(/(?<=[.;])\s+/);
const changedSentences = (before: string, after: string): { old: string; new: string }[] => {
  const a = sentences(before);
  const b = sentences(after);
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i)
    .filter((i) => a[i] !== b[i])
    .map((i) => ({ old: a[i] ?? '', new: b[i] ?? '' }));
};

const LISTS = ['allow', 'soft_deny'] as const;
const rules = LISTS.flatMap((list) =>
  canonical.autoMode[list]
    .filter((text) => text !== '$defaults')
    .map((text) => {
      const current = (mine[list] ?? []).find((rule) => ruleName(rule) === ruleName(text));
      const state = current === undefined ? 'missing' : current === text ? 'current' : 'stale';
      return { list, name: ruleName(text), state, text, changes: current ? changedSentences(current, text) : [] };
    })
);
const adopted = LISTS.some((list) => (mine[list] ?? []).some((rule) => rule !== '$defaults'));
const status = !adopted ? 'absent' : rules.some((rule) => rule.state !== 'current') ? 'stale' : 'current';
const replacements = rules.filter((rule) => rule.state !== 'current');

const report = {
  status,
  defaultMode: settings.permissions?.defaultMode ?? null,
  settingsPath,
  rules: rules.map(({ list, name, state }) => ({ list, name, state })),
  replacements: replacements.map(({ list, name, state, text, changes }) => ({ list, name, state, text, changes })),
  block: canonical
};

const note = (): string => {
  const lines = [
    `# Auto-mode block for ${home}`,
    '',
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by the agent-kevin plugin. The plugin never`,
    `edits \`${settingsPath}\`; every change below is yours to paste.`,
    ''
  ];
  if (status === 'current') {
    lines.push('**Status: current.** Your auto-mode block matches the recommended text. Nothing to do.');
  } else if (status === 'absent') {
    lines.push(
      '**Status: absent.** You have not adopted the recommended block. Paste the full block at the end of this',
      `note into \`${settingsPath}\` (merge \`permissions.defaultMode\` and \`autoMode\` at the top level).`
    );
  } else {
    lines.push(
      `**Status: stale.** ${replacements.length} of ${rules.length} rules need replacing in \`${settingsPath}\`.`,
      'Each rule is one long string inside the `autoMode` arrays; replace the whole string.',
      '',
      '## What to change'
    );
    for (const rule of replacements) {
      lines.push('', `### \`autoMode.${rule.list}\` → the string starting \`"${rule.name}\``, '');
      if (rule.state === 'missing') {
        lines.push('Not in your settings yet — add the string below to that array.', '');
      } else {
        lines.push('Sentences that change:', '');
        for (const change of rule.changes) lines.push(`- OLD: ${change.old}`, `- NEW: ${change.new}`, '');
      }
      lines.push(
        'Full replacement string (paste over the whole entry):',
        '',
        '```json',
        JSON.stringify(rule.text),
        '```'
      );
    }
  }
  // The full block is the single-home template. An operator who already has a block has
  // extended its `environment` (more homes, more repos); offering the template whole would
  // invite them to paste over that, so it appears only when there is nothing to lose.
  if (status === 'absent') {
    lines.push('', '## Full recommended block', '', '```json', JSON.stringify(canonical, null, 2), '```');
  } else {
    lines.push(
      '',
      'Your `environment` entries are yours (homes, repos, trust) and are never compared or replaced;',
      'only the named rules are ever checked.'
    );
  }
  lines.push('');
  return lines.join('\n');
};

const out = flag('out');
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, note());
}
process.stdout.write(JSON.stringify(args.includes('--check') ? report : canonical, null, 2) + '\n');
