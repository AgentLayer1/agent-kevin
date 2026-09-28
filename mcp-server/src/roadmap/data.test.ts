import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkRoadmapHtml,
  readRoadmapHtml,
  ROADMAP_PARSE_LINE,
  roadmapDataBlock,
  roadmapMilestones,
  serializeRoadmapData
} from './data';

const page = (block: string): string =>
  `<!doctype html><body><div id="render"></div>${block}<script>render()</script></body>`;

describe('the data block', () => {
  test('round-trips, and a string holding </script> cannot end the block early', () => {
    const data = { h1: { title: 'H1', note: 'ends with </script><script>alert(1)</script> and <!-- a comment' } };
    const html = page(roadmapDataBlock(data));
    expect(html.match(/<\/script>/g)?.length).toBe(2);
    expect(html).not.toContain('<!--');
    expect(readRoadmapHtml(html)).toMatchObject({ kind: 'data', data });
  });

  test('values JSON cannot carry are refused with their path', () => {
    expect(() => serializeRoadmapData({ a: { b: [1, () => 2] } })).toThrow('ROADMAP.a.b[1] is a function');
    expect(() => serializeRoadmapData({ a: undefined })).toThrow('ROADMAP.a is undefined');
    expect(() => serializeRoadmapData({ a: Number.NaN })).toThrow('ROADMAP.a is NaN');
  });

  test('an unmigrated page reads as legacy, broken JSON as invalid, anything else as not a roadmap', () => {
    expect(readRoadmapHtml('<script>\n  const ROADMAP = {\n  a: 1 };</script>')).toEqual({ kind: 'legacy' });
    expect(readRoadmapHtml(page('<script type="application/json" id="roadmap-data">{ a: 1 }</script>'))?.kind).toBe(
      'invalid'
    );
    expect(readRoadmapHtml('<p>hello</p>')).toBeNull();
  });
});

describe('roadmapMilestones', () => {
  test('finds milestones in the template shape, dated by their period', () => {
    const milestones = roadmapMilestones({
      q4: {
        kind: 'timeline',
        title: 'Q4 — Ship',
        periods: [
          {
            name: 'October',
            start: '2026-10',
            milestones: [
              {
                chip: 'M7',
                title: 'Launch',
                items: [{ text: 'Promo codes (<code>ac-012</code>)', status: 'progress' }]
              },
              [
                { chip: 'M8', title: 'Webhooks', items: [{ text: 'Receiver', status: 'done' }] },
                { chip: 'M9', title: 'Content', items: [{ text: 'Pipeline' }] }
              ]
            ]
          },
          { name: 'Later', milestones: [{ chip: 'M10', title: 'Email', items: [{ text: 'Drip', status: 'planned' }] }] }
        ],
        outcomes: [{ icon: '🚀', label: 'Launch', desc: 'Live' }]
      }
    });
    expect(milestones.map((item) => item.chip)).toEqual(['M7', 'M8', 'M9', 'M10']);
    expect(milestones[0]).toMatchObject({
      section: 'Q4 — Ship',
      window: { start: '2026-10-01', end: '2026-10-31' },
      taskIds: ['ac-012']
    });
    expect(milestones[2].items).toEqual([{ text: 'Pipeline', status: 'planned' }]);
    expect(milestones[3].window).toBeNull();
  });

  test('finds them in a custom shape too: lanes, card strips, a section-level range', () => {
    const milestones = roadmapMilestones({
      agent: {
        label: 'The agent',
        start: '2026-09-28',
        end: '2026-12-31',
        periods: [
          {
            name: 'Oct',
            milestones: [{ chip: 'A1', title: 'Pilot', items: [{ text: 'al-011 submitted', status: 'progress' }] }]
          }
        ]
      },
      foundations: { cards: [{ theme: 'Gates', items: [{ text: 'CP204', status: 'done' }] }] }
    });
    expect(milestones).toEqual([
      {
        chip: 'A1',
        title: 'Pilot',
        section: 'The agent',
        window: { start: '2026-09-28', end: '2026-12-31' },
        items: [{ text: 'al-011 submitted', status: 'progress' }],
        taskIds: ['al-011']
      },
      {
        chip: '',
        title: 'Gates',
        section: 'foundations',
        window: null,
        items: [{ text: 'CP204', status: 'done' }],
        taskIds: []
      }
    ]);
  });

  test('an unparseable date leaves the milestone undated rather than guessing', () => {
    const [milestone] = roadmapMilestones({ s: { start: 'Q4', items: [{ text: 'x', status: 'planned' }] } });
    expect(milestone.window).toBeNull();
  });
});

describe('checkRoadmapHtml', () => {
  const block = (json: string): string => page(`<script type="application/json" id="roadmap-data">${json}</script>`);

  test('a dated, script-safe block with known statuses passes', () => {
    const html = page(
      roadmapDataBlock({
        s: {
          periods: [{ name: 'Oct', start: '2026-10', milestones: [{ items: [{ text: '<b>x</b>', status: 'done' }] }] }]
        }
      })
    );
    expect(checkRoadmapHtml(html)).toEqual({ errors: [], warnings: [] });
  });

  test('bad dates, unknown statuses and a raw </ are errors; undated milestones are a warning', () => {
    const { errors, warnings } = checkRoadmapHtml(
      block(
        '{ "s": { "periods": [ { "name": "Oct", "end": "October", "milestones": [ { "items": [ { "text": "<b>x</b>", "status": "wip" } ] } ] } ] } }'
      )
    );
    expect(errors).toEqual([
      'inside the roadmap-data block, write </ as <\\/ and <!-- as <\\u0021--',
      'ROADMAP.s.periods[0].end "October" is not a date: use 2026-10-05, 2026-W41 or 2026-10',
      'ROADMAP.s.periods[0].milestones[0].items[0].status "wip" must be one of done, progress, planned'
    ]);
    expect(warnings).toEqual([
      '1 milestone(s) have no start date (first: s), so focus pages only see their in-progress items'
    ]);
  });

  test('an unmigrated page is sent to the migration, never a hand conversion', () => {
    expect(checkRoadmapHtml('<script>const ROADMAP = { a: 1 };</script>').errors[0]).toContain(
      'run_upgrade { version: "0.5.3" }'
    );
  });

  test('items focus pages would skip are a warning', () => {
    const html = page(roadmapDataBlock({ s: { start: '2026-10', items: [{ text: 'fine' }, 'a bare string'] } }));
    expect(checkRoadmapHtml(html).warnings).toEqual([
      'ROADMAP.s.items holds something other than { text, status }, so focus pages skip this milestone'
    ]);
  });

  test('`later`, or an end before its start, is not a window', () => {
    const { errors } = checkRoadmapHtml(
      page(
        roadmapDataBlock({
          s: {
            periods: [
              { name: 'A', start: 'later' },
              { name: 'B', start: '2026-10', end: '2026-09' }
            ]
          }
        })
      )
    );
    expect(errors).toEqual([
      'ROADMAP.s.periods[0].start "later" is not a date: use 2026-10-05, 2026-W41 or 2026-10',
      'ROADMAP.s.periods[1].end comes before its start'
    ]);
    const [milestone] = roadmapMilestones({ s: { start: '2026-10', end: '2026-09', items: [{ text: 'x' }] } });
    expect(milestone.window).toBeNull();
  });

  test('the block is found whatever order its attributes come in', () => {
    const html = page('<script id="roadmap-data" type="application/json">{"a":1}</script>');
    expect(readRoadmapHtml(html)).toMatchObject({ kind: 'data', data: { a: 1 } });
  });
});

describe('the template', () => {
  test('carries the block and the line that parses it, and passes its own check with only the ongoing strip undated', () => {
    const template = readFileSync(
      resolve(import.meta.dir, '../../../skills/roadmap/references/template.html'),
      'utf-8'
    );
    expect(template).toContain('<script type="application/json" id="roadmap-data">');
    expect(template).toContain(ROADMAP_PARSE_LINE);
    expect(checkRoadmapHtml(template)).toEqual({
      errors: [],
      warnings: [
        '2 milestone(s) have no start date (first: Company brain), so focus pages only see their in-progress items'
      ]
    });
  });
});
