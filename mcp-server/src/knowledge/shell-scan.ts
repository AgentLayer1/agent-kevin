export interface ShellWord {
  /** The word with quotes and escapes removed; a command substitution reads as `$(…)`. */
  text: string;
  /** Holds an unquoted `*`, `?` or `[`, so the shell would expand it. */
  globbed: boolean;
}

export interface ShellCommand {
  words: ShellWord[];
  /** 0 runs in the session's shell; deeper runs in a subshell or command substitution. */
  depth: number;
}

const HEREDOC = /(?<!<)<<-?\s*(["']?)([\w.-]+)\1/;
const REDIRECT = /^(?:&>>?|[<>]+&?(?:\d+-?|-)?)/;

const withoutHeredocBodies = (script: string): string => {
  const lines = script.split('\n');
  const kept: string[] = [];
  let delimiter: string | undefined;
  for (const line of lines) {
    if (delimiter !== undefined) {
      if (line.trim() === delimiter) {
        delimiter = undefined;
      }
      continue;
    }
    kept.push(line);
    delimiter = HEREDOC.exec(line)?.[2];
  }
  return kept.join('\n');
};

/**
 * Splits a shell command into its simple commands, the way the shell would: quotes and escapes
 * hold, a subshell or command substitution is its own command one level deeper, and heredoc
 * bodies and comments are dropped. Commands come out in the order they end.
 */
export function scanShell(script: string): ShellCommand[] {
  const source = withoutHeredocBodies(script);
  const commands: ShellCommand[] = [];

  const scan = (start: number, depth: number, closer: string | undefined): number => {
    let words: ShellWord[] = [];
    let text = '';
    let globbed = false;
    let inWord = false;
    let quoted = false;
    const endWord = (): void => {
      if (inWord) {
        words.push({ text, globbed });
      }
      text = '';
      globbed = false;
      inWord = false;
    };
    const endCommand = (): void => {
      endWord();
      if (words.length) {
        commands.push({ words, depth });
      }
      words = [];
    };
    const nested = (from: number, nestedCloser: string): number => {
      inWord = true;
      text += '$(…)';
      return scan(from, depth + 1, nestedCloser);
    };

    let i = start;
    while (i < source.length) {
      const ch = source[i];
      const next = source[i + 1];
      if (ch === '\\' && (!quoted || '$`"\\\n'.includes(next ?? ''))) {
        text += next ?? '';
        inWord = true;
        i += 2;
      } else if (ch === closer && !quoted) {
        endCommand();
        return i + 1;
      } else if (ch === '$' && next === '(') {
        i = nested(i + 2, ')');
      } else if (ch === '`') {
        i = nested(i + 1, '`');
      } else if (quoted) {
        quoted = ch !== '"';
        text += quoted ? ch : '';
        i += 1;
      } else if (ch === '"') {
        quoted = true;
        inWord = true;
        i += 1;
      } else if (ch === "'") {
        const end = source.indexOf("'", i + 1);
        const stop = end < 0 ? source.length : end;
        text += source.slice(i + 1, stop);
        inWord = true;
        i = stop + 1;
      } else if (ch === '(' && !inWord) {
        endCommand();
        i = scan(i + 1, depth + 1, ')');
      } else if (ch === '#' && !inWord) {
        const end = source.indexOf('\n', i);
        i = end < 0 ? source.length : end;
      } else if (ch === '<' || ch === '>' || (ch === '&' && next === '>')) {
        const fd = /^\d+$/.test(text) ? text : '';
        if (fd) {
          text = '';
          inWord = false;
        }
        endWord();
        const operator = REDIRECT.exec(source.slice(i))?.[0] ?? ch;
        words.push({ text: fd + operator, globbed: false });
        i += operator.length;
      } else if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') {
        endCommand();
        i += 1;
      } else if (ch === ' ' || ch === '\t') {
        endWord();
        i += 1;
      } else {
        globbed ||= ch === '*' || ch === '?' || ch === '[';
        text += ch;
        inWord = true;
        i += 1;
      }
    }
    endCommand();
    return i;
  };

  scan(0, 0, undefined);
  return commands;
}

const PREFIXES = new Set([
  '{',
  '}',
  '!',
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  'time',
  'builtin',
  'command'
]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/** The words from the command name on, past keywords, `builtin`/`command` and `NAME=value` prefixes. */
export const commandWords = (command: ShellCommand): ShellWord[] => {
  const start = command.words.findIndex((word) => !PREFIXES.has(word.text) && !ASSIGNMENT.test(word.text));
  return start < 0 ? [] : command.words.slice(start);
};
