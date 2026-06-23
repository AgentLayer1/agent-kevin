import { describe, expect, test } from 'bun:test';
// Config-free by design (see header) so importing it never freezes KEVIN_HOME
// for the shared bun-test module registry.
import { assignPrefixes, derivePrefix } from './prefix';

const entry = (project: string, inferred: string | null = null) => ({ project, inferred });

describe('derivePrefix', () => {
  test('single word → first two letters', () => {
    expect(derivePrefix('vetra')).toBe('ve');
    expect(derivePrefix('homestead')).toBe('ho');
  });

  test('compound → first letter of the first two parts', () => {
    expect(derivePrefix('agent-layer')).toBe('al');
    expect(derivePrefix('pray-watch')).toBe('pw');
    expect(derivePrefix('prophetic-day-routine')).toBe('pd');
  });
});

describe('assignPrefixes', () => {
  test('assigns derived prefixes to empty projects', () => {
    const map = assignPrefixes([entry('vetra'), entry('agent-layer')]);
    expect(map.get('ve')).toBe('vetra');
    expect(map.get('al')).toBe('agent-layer');
  });

  test('an inferred prefix is used verbatim, not re-derived from the slug', () => {
    // `homestead` would derive `ho`, but its task files use `hd`.
    const map = assignPrefixes([entry('homestead', 'hd')]);
    expect(map.get('hd')).toBe('homestead');
    expect(map.has('ho')).toBe(false);
  });

  test('a tasked project keeps its prefix even when an empty colliding project comes first', () => {
    // `widget-works` (empty) is listed first and derives `ww`; `wwise` has real
    // ww-* task files. The tasked project must claim the bare `ww` — otherwise
    // `ww-001` would resolve to the wrong project — and the empty one yields.
    const map = assignPrefixes([entry('widget-works'), entry('wwise', 'ww')]);
    expect(map.get('ww')).toBe('wwise');
    expect(map.get('ww2')).toBe('widget-works');
  });

  test('two empty projects deriving the same prefix get distinct suffixed slots', () => {
    const map = assignPrefixes([entry('cobra-cola'), entry('coca-cyan')]);
    expect(map.get('cc')).toBe('cobra-cola');
    expect(map.get('cc2')).toBe('coca-cyan');
  });

  test('two authoritative prefixes colliding fires onConflict and stays total', () => {
    const conflicts: Array<[string, string]> = [];
    const map = assignPrefixes(
      [entry('alpha', 'aa'), entry('atlas', 'aa')],
      (prefix, project) => conflicts.push([prefix, project])
    );
    expect(conflicts).toEqual([['aa', 'atlas']]);
    expect(map.get('aa')).toBe('alpha');
    expect(map.get('aa2')).toBe('atlas');
  });
});
