import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import { DIAGRAM_TEMPLATES, DIAGRAM_VIEWER_BLOCK, diagramViewerBlockOf, withDiagramViewerBlock } from './diagram-viewer';

describe('diagram viewer block', () => {
  test.each([...DIAGRAM_TEMPLATES])('%s carries the current block in <head>', (relative) => {
    const html = readFileSync(join(FOLDERS.ROOT, relative), 'utf-8');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(diagramViewerBlockOf(head), 'run: bun mcp-server/src/shared/diagram-viewer.ts sync').toBe(DIAGRAM_VIEWER_BLOCK);
  });

  test('a sync replaces a stale block and leaves the rest of the page alone', () => {
    const page = '<head>\n<!-- diagram-viewer:start -->old<!-- diagram-viewer:end -->\n</head><body>$& $1</body>';
    expect(withDiagramViewerBlock(page)).toBe(`<head>\n${DIAGRAM_VIEWER_BLOCK}\n</head><body>$& $1</body>`);
  });
});

const DRAWN = '<svg viewBox="0 0 800 400"><g><text>drawn</text></g></svg>';

const page = async (body: string) => {
  const dom = new JSDOM(`<!doctype html><html><head>${DIAGRAM_VIEWER_BLOCK}</head><body>${body}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: (window) => {
      // jsdom has no modal dialogs; this marks the dialog open the way a browser would.
      window.HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      window.HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new window.Event('close'));
      };
    }
  });
  const { document } = dom.window;
  if (document.readyState === 'loading') {
    await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve));
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { document, settle };
};

describe('diagram viewer', () => {
  test('a drawn diagram gets one expand button, an undrawn one gets none', async () => {
    const { document } = await page(`<div class="diagram" id="drawn">${DRAWN}</div><pre class="diagram" id="source">flowchart LR\n  A --> B</pre>`);
    expect(document.querySelectorAll('#drawn > .dv-open')).toHaveLength(1);
    expect(document.querySelectorAll('#source > .dv-open')).toHaveLength(0);
  });

  test('a redraw that replaces the diagram gets its button back', async () => {
    const { document, settle } = await page('<div class="diagram" id="box">flowchart LR</div>');
    const box = document.getElementById('box');
    if (!box) {
      throw new Error('no box');
    }
    box.innerHTML = DRAWN;
    await settle();
    expect(box.querySelectorAll(':scope > .dv-open')).toHaveLength(1);
    box.innerHTML = DRAWN;
    await settle();
    expect(box.querySelectorAll(':scope > .dv-open')).toHaveLength(1);
  });

  test('the button opens the diagram in a titled viewer, and closing empties it', async () => {
    const { document } = await page(`<section><h2>Architecture</h2><div class="diagram">${DRAWN}</div></section>`);
    document.querySelector<HTMLButtonElement>('.dv-open')?.click();
    const dialog = document.querySelector('dialog.dv');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(document.querySelector('.dv-title')?.textContent).toBe('Architecture');
    expect(document.querySelector('.dv-stage > svg text')?.textContent).toBe('drawn');
    document.querySelector<HTMLButtonElement>('.dv-bar button[aria-label="Close (Esc)"]')?.click();
    expect(dialog?.hasAttribute('open')).toBe(false);
    expect(document.querySelector('.dv-stage')?.children).toHaveLength(0);
  });
});
