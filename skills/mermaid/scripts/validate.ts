/**
 * Mermaid parse-validator (Tier 1). Extracts every ```mermaid fenced block
 * from the given markdown/text files and runs `mermaid.parse()` on each,
 * reporting the first syntax error per failing block and exiting non-zero if
 * any block fails.
 *
 * Parse-only: catches blocks that would fail to render (bad arrows, reserved
 * words, unclosed shapes, `<`/`>` in labels). It does NOT judge layout or
 * theme legibility; that's the Tier 2 visual pass in SKILL.md.
 *
 * Runs headless via a jsdom DOM shim. Kept a standalone script (not an
 * inline import) so the global-shim pollution stays contained to this
 * short-lived process instead of leaking into the MCP server.
 *
 * Deps (mermaid, jsdom) resolve from the plugin's mcp-server/node_modules;
 * invoke with NODE_PATH pointed there (see SKILL.md). No network at runtime.
 *
 *   NODE_PATH="$CLAUDE_PLUGIN_ROOT/mcp-server/node_modules" \
 *     bun run "$CLAUDE_PLUGIN_ROOT/skills/mermaid/scripts/validate.ts" <file...>
 */

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://localhost' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  DOMParser: dom.window.DOMParser,
  Element: dom.window.Element,
  SVGElement: dom.window.SVGElement,
  HTMLElement: dom.window.HTMLElement
});

const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

const MERMAID_BLOCK_RE = /```mermaid\n([\s\S]*?)```/g;

interface BlockResult {
  file: string;
  index: number;
  ok: boolean;
  diagramType?: string;
  error?: string;
}

const firstErrorLine = (err: unknown): string => {
  const lines = String(err instanceof Error ? err.message : err).split('\n');
  return lines.find((line) => /parse error|error/i.test(line))?.trim() ?? lines[0].trim();
};

const validateFile = async (file: string): Promise<BlockResult[]> => {
  const src = await Bun.file(file).text();
  const blocks = [...src.matchAll(MERMAID_BLOCK_RE)].map((match) => match[1]);
  return Promise.all(
    blocks.map(async (block, index): Promise<BlockResult> => {
      try {
        const parsed = await mermaid.parse(block);
        return { file, index, ok: true, diagramType: parsed?.diagramType };
      } catch (err) {
        return { file, index, ok: false, error: firstErrorLine(err) };
      }
    })
  );
};

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: validate.ts <file...>');
  process.exit(2);
}

const results = (await Promise.all(files.map(validateFile))).flat();
const failures = results.filter((result) => !result.ok);

for (const result of results) {
  const label = `${result.file} block ${result.index + 1}`;
  if (result.ok) {
    console.log(`OK   ${label} (${result.diagramType})`);
  } else {
    console.log(`FAIL ${label} -> ${result.error}`);
  }
}

if (results.length === 0) {
  console.log('no mermaid blocks found');
} else {
  console.log(failures.length ? `${failures.length}/${results.length} FAILED` : `ALL ${results.length} CLEAN`);
}

process.exit(failures.length ? 1 : 0);
