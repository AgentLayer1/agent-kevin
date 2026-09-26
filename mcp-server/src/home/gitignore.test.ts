import { describe, expect, test } from 'bun:test';
import { reconcileGitignore } from '@/home/gitignore';

describe('reconcileGitignore', () => {
  test("uses the home's runtime folder name when it isn't the template's", () => {
    const template = '.kevin/*\n!.kevin/knowledge.json\n.claude/settings.local.json*\n';
    const { text } = reconcileGitignore('', template, { from: '.kevin', to: '.custom' });
    expect(text).toContain('.custom/*\n!.custom/knowledge.json');
    expect(text).not.toContain('.kevin');
  });
});
