import { agentDisplayName, agentFormerNames, renameAgent, withoutFormerNames } from '@/shared/agent-name';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { RUNTIME_DIR } from '@/shared/naming';

/**
 * Run `fn` against a throwaway home whose `IDENTITY.md` holds `body` (omit to
 * leave the file absent). `AGENT_HOME` is restored afterwards.
 */
const withIdentity = <T>(body: string | undefined, fn: () => T): T => {
  const home = mkdtempSync(resolve(tmpdir(), 'agent-name-test-'));
  mkdirSync(resolve(home, RUNTIME_DIR), { recursive: true });
  if (body !== undefined) {
    writeFileSync(resolve(home, 'IDENTITY.md'), body);
  }
  const priorHome = process.env.AGENT_HOME;
  process.env.AGENT_HOME = home;
  try {
    return fn();
  } finally {
    if (priorHome === undefined) delete process.env.AGENT_HOME;
    else process.env.AGENT_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
  }
};

const identity = (name: string): string => `# Identity\n\n## Who\n\n- **Name:** ${name}\n- **Emoji:** 🍌\n`;

describe('agentDisplayName', () => {
  test('reads a renamed agent from IDENTITY.md', () => {
    expect(withIdentity(identity('Vega'), agentDisplayName)).toBe('Vega');
  });

  test("reads a Name written without a dash bullet, as the dashboard's field reader does", () => {
    expect(withIdentity('# Identity\n\n* **Name:** Vega\n', agentDisplayName)).toBe('Vega');
  });

  test('multi-word names survive intact', () => {
    expect(withIdentity(identity('Ada Lovelace'), agentDisplayName)).toBe('Ada Lovelace');
  });

  test('falls back to the plugin name when the Name field is absent', () => {
    expect(withIdentity('# Identity\n\n## Who\n\n- **Kind:** AI assistant\n', agentDisplayName)).toBe('Kevin');
  });

  test('falls back when IDENTITY.md does not exist (pre-init home)', () => {
    expect(withIdentity(undefined, agentDisplayName)).toBe('Kevin');
  });

  test('an empty Name falls back instead of capturing the next line', () => {
    // `\s` matches newlines, so a `\s*(.+)$` field reader walks past an empty
    // value and captures whatever follows — the agent ends up calling itself
    // "- **Kind:** AI assistant" in the banner, in TASKS.md, and in the compile
    // prompts that write its name into long-term memory.
    const emptyName = '# Identity\n\n## Who\n\n- **Name:** \n- **Kind:** AI assistant\n';
    expect(withIdentity(emptyName, agentDisplayName)).toBe('Kevin');
  });

  test('a Name of only whitespace falls back too', () => {
    expect(withIdentity(identity('   '), agentDisplayName)).toBe('Kevin');
  });

  test('an unsubstituted init token falls back instead of leaking the placeholder', () => {
    // A failed init leaves `{{AGENT_NAME}}` in the file. Rendering that verbatim
    // would put the raw token in the session banner, TASKS.md, and every compile
    // prompt — worse than showing the default.
    expect(withIdentity(identity('{{AGENT_NAME}}'), agentDisplayName)).toBe('Kevin');
  });

  test('is read live, so a rename takes effect without a restart', () => {
    const home = mkdtempSync(resolve(tmpdir(), 'agent-name-live-'));
    mkdirSync(resolve(home, RUNTIME_DIR), { recursive: true });
    const priorHome = process.env.AGENT_HOME;
    process.env.AGENT_HOME = home;
    try {
      writeFileSync(resolve(home, 'IDENTITY.md'), identity('Kevin'));
      expect(agentDisplayName()).toBe('Kevin');
      writeFileSync(resolve(home, 'IDENTITY.md'), identity('Vega'));
      expect(agentDisplayName()).toBe('Vega');
    } finally {
      if (priorHome === undefined) delete process.env.AGENT_HOME;
      else process.env.AGENT_HOME = priorHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('agentFormerNames', () => {
  test('reads the Formerly list in order', () => {
    expect(withIdentity(`${identity('Nova')}- **Formerly:** Kevin, Vega\n`, agentFormerNames)).toEqual([
      'Kevin',
      'Vega'
    ]);
  });

  test('is empty for an agent never renamed', () => {
    expect(withIdentity(identity('Kevin'), agentFormerNames)).toEqual([]);
  });
});

describe('renameAgent', () => {
  test('renames whole words, possessives and sentence ends', () => {
    expect(renameAgent("Kevin's notes. Ask Kevin. Kevinism stays.", 'Kevin', 'Vega')).toBe(
      "Vega's notes. Ask Vega. Kevinism stays."
    );
  });

  test('leaves a name that is part of a path or identifier', () => {
    const text = [
      '`~/Documents/Agents/Kevin/`',
      'C:\\Agents\\Kevin',
      '~/.local/state/agent-kevin/Documents-Agents-Kevin.git',
      'X-Kevin-Test'
    ].join('\n');
    expect(renameAgent(text, 'Kevin', 'Vega')).toBe(text);
  });

  test('handles multi-word names and replacement text with $ patterns', () => {
    expect(renameAgent('Ada Lovelace says hi', 'Ada Lovelace', 'Vega')).toBe('Vega says hi');
    expect(renameAgent('Scout here', 'Scout', "$&$'")).toBe("$&$' here");
  });

  test('renames inside markdown italics and identifiers joined by an underscore', () => {
    expect(renameAgent("_Kevin's notes_ and kevin_Kevin", 'Kevin', 'Vega')).toBe("_Vega's notes_ and kevin_Vega");
  });

  test('a mention already inside the new name stays, so a rerun is a no-op', () => {
    expect(renameAgent('Kevin and Kevin Prime', 'Kevin', 'Kevin Prime')).toBe('Kevin Prime and Kevin Prime');
  });
});

describe('withoutFormerNames', () => {
  test('drops only the Formerly line', () => {
    expect(withoutFormerNames('- **Name:** Vega\n- **Formerly:** Kevin\n- **Emoji:** 🍌\n')).toBe(
      '- **Name:** Vega\n- **Emoji:** 🍌\n'
    );
  });
});
