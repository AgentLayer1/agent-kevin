import { describe, expect, test } from 'bun:test';
import { type DOMWindow, JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import { THEME_BLOCK, THEMED_TEMPLATES, themeBlockOf, withThemeBlock } from './theme';

describe('theme block', () => {
  test.each([...THEMED_TEMPLATES])('%s carries the current block in <head>', (relative) => {
    const html = readFileSync(join(FOLDERS.ROOT, relative), 'utf-8');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(themeBlockOf(head), `run: bun mcp-server/src/shared/theme.ts sync`).toBe(THEME_BLOCK);
  });

  test('a sync replaces a stale block and leaves the rest of the page alone', () => {
    const page = '<head>\n<!-- theme:start -->old<!-- theme:end -->\n</head><body>$& $1</body>';
    expect(withThemeBlock(page)).toBe(`<head>\n${THEME_BLOCK}\n</head><body>$& $1</body>`);
  });
});

const media = () => {
  const listeners: (() => void)[] = [];
  const state = { matches: true };
  const stub = (window: DOMWindow): void => {
    // jsdom has no matchMedia; this one lets a test flip the system appearance.
    window.matchMedia = (query: string) =>
      ({ get matches() { return state.matches; }, media: query, addEventListener: (_: string, listener: () => void) => listeners.push(listener) }) as unknown as MediaQueryList;
  };
  const flip = (dark: boolean): void => {
    state.matches = dark;
    listeners.forEach((listener) => listener());
  };
  return { stub, flip };
};

const open = async (body: string, saved?: string) => {
  const system = media();
  const dom = new JSDOM(`<!doctype html><html><head>${THEME_BLOCK}</head><body>${body}</body></html>`, {
    runScripts: 'dangerously',
    url: 'https://pages.test/page.html',
    beforeParse: (window) => {
      system.stub(window);
      if (saved !== undefined) {
        window.localStorage.setItem('agent-theme', saved);
      }
    }
  });
  const { document } = dom.window;
  if (document.readyState === 'loading') {
    await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve));
  }
  const changes: string[] = [];
  document.addEventListener('themechange', (event) => changes.push(String((event as CustomEvent).detail.mode)));
  const pressed = () => [...document.querySelectorAll('.theme-switch button[aria-pressed="true"]')].map((button) => button.getAttribute('data-choice'));
  const click = (choice: string) => document.querySelector<HTMLButtonElement>(`.theme-switch button[data-choice="${choice}"]`)?.click();
  return { document, root: document.documentElement, window: dom.window, changes, pressed, click, flip: system.flip };
};

describe('theme control', () => {
  test('defaults to Auto and follows the system', async () => {
    const page = await open('<span id="theme-slot"></span>');
    expect(page.root.getAttribute('data-theme')).toBe('dark');
    expect(page.pressed()).toEqual(['auto']);
    page.flip(false);
    expect(page.root.getAttribute('data-theme')).toBe('light');
    expect(page.changes).toEqual(['light']);
  });

  test('a pick is saved, announced, and holds when the system flips', async () => {
    const page = await open('<span id="theme-slot"></span>');
    page.click('light');
    expect(page.root.getAttribute('data-theme')).toBe('light');
    expect(page.window.localStorage.getItem('agent-theme')).toBe('light');
    expect(page.pressed()).toEqual(['light']);
    page.flip(true);
    expect(page.root.getAttribute('data-theme')).toBe('light');
    expect(page.changes).toEqual(['light']);
  });

  test('a saved pick applies before the body, and a bad one falls back to Auto', async () => {
    expect((await open('', 'light')).root.getAttribute('data-theme')).toBe('light');
    expect((await open('', 'sepia')).pressed()).toEqual(['auto']);
    expect((await open('', 'toString')).pressed()).toEqual(['auto']);
  });

  test('mounts in the slot when the page has one, else floats', async () => {
    expect((await open('<span id="theme-slot"></span>')).document.querySelector('#theme-slot > .theme-switch')).not.toBeNull();
    expect((await open('')).document.querySelector('body > .theme-switch.floating')).not.toBeNull();
  });
});
