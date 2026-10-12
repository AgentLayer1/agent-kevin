import { describe, expect, test } from 'bun:test';
import { commandWords, scanShell } from './shell-scan';

const texts = (script: string): { depth: number; words: string[] }[] =>
  scanShell(script).map((command) => ({
    depth: command.shells.length - 1,
    words: command.words.map((word) => word.text)
  }));

describe('scanShell', () => {
  test('splits on the shell operators', () => {
    expect(texts('cd /repo && git status; ls | head -1 || echo no & wait')).toEqual([
      { depth: 0, words: ['cd', '/repo'] },
      { depth: 0, words: ['git', 'status'] },
      { depth: 0, words: ['ls'] },
      { depth: 0, words: ['head', '-1'] },
      { depth: 0, words: ['echo', 'no'] },
      { depth: 0, words: ['wait'] }
    ]);
  });

  test('keeps quoted separators and spaces inside one word', () => {
    expect(texts(`echo "a; cd /x" 'b && c' d\\ e`)).toEqual([
      { depth: 0, words: ['echo', 'a; cd /x', 'b && c', 'd e'] }
    ]);
  });

  test('a subshell and a command substitution run one level deeper', () => {
    expect(texts('(cd /repo && make) && T=$(mktemp -d) && echo "$(pwd)" `date`')).toEqual([
      { depth: 1, words: ['cd', '/repo'] },
      { depth: 1, words: ['make'] },
      { depth: 1, words: ['mktemp', '-d'] },
      { depth: 0, words: ['T=$(…)'] },
      { depth: 1, words: ['pwd'] },
      { depth: 1, words: ['date'] },
      { depth: 0, words: ['echo', '$(…)', '$(…)'] }
    ]);
  });

  test('keeps backslashes in double quotes unless they escape a special character', () => {
    expect(texts('cd "C:\\Users\\acme" && echo "a\\"b" "\\$HOME"')).toEqual([
      { depth: 0, words: ['cd', 'C:\\Users\\acme'] },
      { depth: 0, words: ['echo', 'a"b', '$HOME'] }
    ]);
  });

  test('a backslash at the end of a line joins the lines', () => {
    expect(texts('cd \\\n  /repo && ls')).toEqual([
      { depth: 0, words: ['cd', '/repo'] },
      { depth: 0, words: ['ls'] }
    ]);
  });

  test('each subshell is its own shell, so sibling subshells never share one', () => {
    expect(scanShell('(cd /a); (cd /b) && echo $(pwd)').map((command) => command.shells)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [0]
    ]);
  });

  test('marks redirections, not words that only read like one', () => {
    const [command] = scanShell("grep -c '>' notes.md > out.txt");
    expect(command?.words.map((word) => word.operator)).toEqual([false, false, false, false, true, false]);
  });

  test('marks only unquoted glob characters', () => {
    const [command] = scanShell(`ls /tmp/a-* "/tmp/b-*" '/tmp/c?' "$DIR"/d-[0-9]`);
    expect(command?.words.map((word) => word.globbed)).toEqual([false, true, false, false, true]);
  });

  test('redirections are their own words, fd numbers included', () => {
    expect(texts('make 2>&1 >out.log && cat <in.txt &>all.log')).toEqual([
      { depth: 0, words: ['make', '2>&1', '>', 'out.log'] },
      { depth: 0, words: ['cat', '<', 'in.txt', '&>', 'all.log'] }
    ]);
  });

  test('drops heredoc bodies and comments, but not here-strings', () => {
    expect(texts("cat > notes.md <<'EOF'\ncd /elsewhere\nEOF\necho done # cd /x")).toEqual([
      { depth: 0, words: ['cat', '>', 'notes.md', '<<', 'EOF'] },
      { depth: 0, words: ['echo', 'done'] }
    ]);
    expect(texts('grep x <<< "cd /y"')).toEqual([{ depth: 0, words: ['grep', 'x', '<<<', 'cd /y'] }]);
  });
});

describe('commandWords', () => {
  test('skips keywords, builtin and assignments to reach the command name', () => {
    const names = scanShell('{ cd /a; } && if cd /b; then FOO=1 builtin cd /c; fi').map(
      (command) => commandWords(command)[0]?.text ?? ''
    );
    expect(names).toEqual(['cd', '', 'cd', 'cd', 'fi']);
  });
});
