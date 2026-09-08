import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..');
const read = (rel: string) => JSON.parse(readFileSync(resolve(ROOT, rel), 'utf-8'));

describe('plugin manifests', () => {
  const claude = read('.claude-plugin/plugin.json');
  const codex = read('.codex-plugin/plugin.json');

  test('the Codex manifest tracks the Claude one: same name, version, description, license', () => {
    for (const field of ['name', 'version', 'description', 'license', 'repository']) {
      expect(codex[field]).toBe(claude[field]);
    }
  });

  test('Claude declares the MCP server and hooks in its manifest; the Codex plugin is skills-only (its MCP server and hooks are per home)', () => {
    expect(codex.skills).toBe('./skills/');
    expect(codex.mcpServers).toBeUndefined();
    expect(claude.mcpServers.kevin.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/mcp-server/src/server.ts']);
    expect(claude.hooks).toBe('./hooks/claude.json');
    expect(existsSync(resolve(ROOT, '.mcp.json'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'hooks', 'hooks.json'))).toBe(false);
    expect(codex.interface.defaultPrompt.length).toBeLessThanOrEqual(3);
  });

  test('the repo doubles as a Codex marketplace listing this checkout as the plugin', () => {
    const marketplace = read('.agents/plugins/marketplace.json');
    const claudeCatalog = read('.claude-plugin/marketplace.json');
    expect(marketplace.name).toBe(claudeCatalog.name);
    expect(claudeCatalog.plugins).toEqual([expect.objectContaining({ name: claude.name, source: './' })]);
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: claude.name, source: { source: 'local', path: './' } })
    ]);
  });
});
