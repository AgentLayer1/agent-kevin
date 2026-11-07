import { describe, expect, test } from 'bun:test';
import { parseListeners } from './ports';

describe('parseListeners', () => {
  test('reads every listening port, IPv4 and IPv6, once, and ignores connections', () => {
    const netstat = [
      'Active Internet connections (including servers)',
      'Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)',
      'tcp4       0      0  127.0.0.1.55432        127.0.0.1.61000        ESTABLISHED',
      'tcp4       0      0  *.5432                 *.*                    LISTEN',
      'tcp6       0      0  *.5432                 *.*                    LISTEN',
      'tcp4       0      0  127.0.0.1.8000         *.*                    LISTEN',
      'tcp6       0      0  ::1.3000               *.*                    LISTEN',
      'tcp46      0      0  *.55432                *.*                    LISTEN'
    ].join('\n');

    expect(parseListeners(netstat)).toEqual([3000, 5432, 8000, 55432]);
  });
});
