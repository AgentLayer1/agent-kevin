import { describe, expect, test } from 'bun:test';
import { sanitizeHtml } from './sanitize-html';

describe('sanitizeHtml', () => {
  test('strips scripts but keeps safe presentational markup', async () => {
    const out = await sanitizeHtml('<p>hi <strong>there</strong></p><script>alert(1)</script>');
    expect(out).toContain('<strong>there</strong>');
    expect(out).not.toContain('<script>');
  });

  test('keeps https links by default', async () => {
    const out = await sanitizeHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
  });

  test('drops an obsidian:// href by default', async () => {
    const out = await sanitizeHtml('<a href="obsidian://open?path=%2Fx.md">task</a>');
    expect(out).toContain('task');
    expect(out).not.toContain('obsidian://');
  });

  test('keeps an obsidian:// href when the scheme is allowed', async () => {
    const out = await sanitizeHtml('<a href="obsidian://open?path=%2Fx.md">task</a>', { allowSchemes: ['obsidian'] });
    expect(out).toContain('href="obsidian://open?path=%2Fx.md"');
  });

  test('still blocks javascript: even with another scheme allowed', async () => {
    const out = await sanitizeHtml('<a href="javascript:alert(1)">x</a>', { allowSchemes: ['obsidian'] });
    expect(out).not.toContain('javascript:');
  });
});
