import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On } from 'claude-code';

import { BAND_PROPS, CLI, CODE, HOME, PLUGIN, USER_HOME, fakeHost, machine, run } from './fake-host';
import type { FakeMachine } from './fake-host';

const REPORT_WRITE = `mcp__plugin_${PLUGIN}_${CLI}__report_write` as const;
const EMPTY = 'No reports in this conversation yet.';

const reportPath = (category: string, slug: string) => `${HOME}/reports/${category}/2026-03-10-0900-${slug}.md`;

// The real tool answers with where it wrote; a slug of 'broken' stands for a failed write.
const reportTool = (on: On) =>
  on('tool.call', { tool: REPORT_WRITE }, (_$, e) => {
    const input = e as unknown as { category: string; slug: string };
    return input.slug === 'broken'
      ? { result: 'failed', text: 'write failed', isError: true }
      : { result: 'ok', text: JSON.stringify({ path: reportPath(input.category, input.slug), indexUpdated: true }) };
  });

const setUp = (on: On, host: FakeMachine = machine()) => {
  reportTool(on);
  return fakeHost(on, host);
};

// A call from a subagent's loop carries its agentId, which the kit's typed literal leaves out.
const writeReport = ($: Engine, category: string, slug: string, title: string, agentId?: string) => {
  const call = {
    tool: REPORT_WRITE,
    category,
    slug,
    title,
    skill: 'fixture',
    body: 'body',
    ...(agentId ? { agentId } : {})
  };
  return $.tool.call(call);
};

const OUTSIDE_GRANTS = '/elsewhere/app/index.ts';

const drainSaves = ($: Engine) => run($, 'reports');

const write = ($: Engine, file_path: string) => $.tool.call({ tool: 'Write', file_path, content: 'x' });

const listed = async ($: Engine, args = '') => {
  const result = await run($, 'reports', args);
  return result.context?.[0] ?? result.text;
};

const list = (...rows: string[]) => ['Reports in this conversation:', ...rows.map((row) => `- ${row}`)].join('\n');

const band = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS });

const untilBandShows = ($: Engine, text: string) =>
  Array.from({ length: 20 }).reduce<Promise<string[]>>(async (previous) => {
    const texts = await previous;
    return texts.includes(text) ? texts : bandTexts($);
  }, Promise.resolve([]));

const bandTexts = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  (await (await band($, surface)).findAll({ type: 'Text' })).map((element) => element.text);

describe('/reports', () => {
  test('says so when this conversation wrote nothing, and opens no row', async ($, on) => {
    setUp(on);
    expect(await listed($)).toBe(EMPTY);
    expect((await bandTexts($)).join('')).not.toContain('📎');
  });

  test("lists this conversation's reports and its subagents', in order, relative to the session root", async ($, on) => {
    setUp(on);
    await writeReport($, 'briefings', 'morning', 'Morning brief');
    await writeReport($, 'reviews', 'pr-12', 'PR 12 review', 'agent-1');
    expect(await listed($)).toBe(
      list(
        'reports/briefings/2026-03-10-0900-morning.md · Morning brief',
        'reports/reviews/2026-03-10-0900-pr-12.md · PR 12 review'
      )
    );
  });

  test('shows the HTML page beside a card, and a failed write not at all', async ($, on) => {
    const host = setUp(on);
    host.files[reportPath('reviews', 'pr-12').replace(/\.md$/, '.html')] = '<html></html>';
    await writeReport($, 'reviews', 'pr-12', 'PR 12 review');
    await writeReport($, 'plans', 'broken', 'Never written');
    expect(await listed($)).toBe(list('reports/reviews/2026-03-10-0900-pr-12.html · PR 12 review'));
  });

  test('a rewritten report is listed once, under its latest title', async ($, on) => {
    setUp(on);
    await writeReport($, 'plans', 'spec', 'Draft spec');
    await writeReport($, 'plans', 'spec', 'Final spec');
    expect(await listed($)).toBe(list('reports/plans/2026-03-10-0900-spec.md · Final spec'));
  });

  test('a path outside the session root stays absolute', async ($, on) => {
    setUp(on, machine({ root: '/fixture/elsewhere' }));
    await writeReport($, 'radar', 'where', 'Where am I');
    expect(await listed($)).toBe(list(`${reportPath('radar', 'where')} · Where am I`));
  });

  test('an edited report keeps its title; project documents and the roadmap are listed by name', async ($, on) => {
    setUp(on);
    await writeReport($, 'plans', 'spec', 'Final spec');
    await $.tool.call({ tool: 'Edit', file_path: reportPath('plans', 'spec'), old_string: 'a', new_string: 'b' });
    await write($, `${HOME}/projects/trips/itineraries/langkawi-v1.html`);
    await write($, `${HOME}/projects/acme/careers/interview-card.md`);
    await write($, `${HOME}/roadmap.html`);
    expect(await listed($)).toBe(
      list(
        'reports/plans/2026-03-10-0900-spec.md · Final spec',
        'projects/trips/itineraries/langkawi-v1.html · langkawi-v1.html',
        'projects/acme/careers/interview-card.md · interview-card.md',
        'roadmap.html · roadmap.html'
      )
    );
  });

  test('state and files outside the deliverable folders are not reports', async ($, on) => {
    setUp(on);
    await write($, `${HOME}/reports/index.md`);
    await write($, `${HOME}/reports/pinned.md`);
    await write($, `${HOME}/projects/TASKS.md`);
    await write($, `${HOME}/projects/acme/README.md`);
    await write($, `${HOME}/projects/acme/tasks/ac-001-fixture.md`);
    await write($, `${HOME}/knowledge/memory/index.md`);
    await write($, `${HOME}/notes.html`);
    await write($, `${HOME}/reports/captures/shot.png`);
    await write($, `${CODE}/site/projects/index.html`);
    expect(await listed($)).toBe(EMPTY);
  });

  test('outside an agent home, nothing written counts', async ($, on) => {
    setUp(on, machine({ isHome: false }));
    await write($, `${HOME}/reports/plans/notes.md`);
    expect(await listed($)).toBe(EMPTY);
  });

  test('a page written beside its card is one row, under the card title', async ($, on) => {
    const host = setUp(on);
    const page = reportPath('plans', 'explainer').replace(/\.md$/, '.html');
    await writeReport($, 'plans', 'explainer', 'Architecture explainer');
    host.files[page] = '<html></html>';
    await write($, page);
    expect(await listed($)).toBe(list('reports/plans/2026-03-10-0900-explainer.html · Architecture explainer'));
  });

  test('a page written before its card still takes the card title', async ($, on) => {
    const host = setUp(on);
    const page = reportPath('plans', 'explainer').replace(/\.md$/, '.html');
    host.files[page] = '<html></html>';
    await write($, page);
    await writeReport($, 'plans', 'explainer', 'Architecture explainer');
    expect(await listed($)).toBe(list('reports/plans/2026-03-10-0900-explainer.html · Architecture explainer'));
  });

  test('a page saved again moves its row to the end, still under the card title', async ($, on) => {
    const host = setUp(on);
    const page = reportPath('plans', 'explainer').replace(/\.md$/, '.html');
    await writeReport($, 'plans', 'explainer', 'Architecture explainer');
    await writeReport($, 'briefings', 'morning', 'Morning brief');
    host.files[page] = '<html></html>';
    await write($, page);
    expect(await listed($)).toBe(
      list(
        'reports/briefings/2026-03-10-0900-morning.md · Morning brief',
        'reports/plans/2026-03-10-0900-explainer.html · Architecture explainer'
      )
    );
  });

  test('an edit that cannot be a report costs no process, filesystem or store calls', async ($, on) => {
    const host = setUp(on);
    await $.tool.call({ tool: 'Edit', file_path: OUTSIDE_GRANTS, old_string: 'a', new_string: 'b' });
    await write($, `${HOME}/knowledge/notes.md`);
    await run($, 'reports');
    expect(host.argv).toEqual([]);
    expect(host.fsCalls).toEqual([]);
    expect(host.store.size).toBe(0);
  });

  test('each conversation keeps its own list, so a resumed one still has its reports', async ($, on) => {
    const host = setUp(on);
    await writeReport($, 'briefings', 'morning', 'Morning brief');
    host.sessionId = 'session-2';
    expect(await listed($)).toBe(EMPTY);
    host.sessionId = 'session-1';
    expect(await listed($)).toContain('Morning brief');
  });

  test('keeps the lists of the last 50 conversations', async ($, on) => {
    const host = setUp(on);
    for (const index of Array.from({ length: 51 }, (_unused, item) => item)) {
      host.sessionId = `session-${index}`;
      await writeReport($, 'briefings', `brief-${index}`, `Brief ${index}`);
    }
    await drainSaves($);
    expect(host.store.has('reports:session-0')).toBe(false);
    expect(host.store.has('reports:session-1')).toBe(true);
    expect(host.store.has('reports:session-50')).toBe(true);
  });

  test('a conversation that keeps saving keeps its list while newer ones arrive', async ($, on) => {
    const host = setUp(on);
    await writeReport($, 'briefings', 'first', 'First');
    for (const index of Array.from({ length: 49 }, (_unused, item) => item + 2)) {
      host.sessionId = `session-${index}`;
      await writeReport($, 'briefings', `brief-${index}`, `Brief ${index}`);
    }
    host.sessionId = 'session-1';
    await writeReport($, 'briefings', 'second', 'Second');
    host.sessionId = 'session-51';
    await writeReport($, 'briefings', 'brief-51', 'Brief 51');
    host.sessionId = 'session-1';
    expect(await listed($)).toBe(
      list('reports/briefings/2026-03-10-0900-first.md · First', 'reports/briefings/2026-03-10-0900-second.md · Second')
    );
    expect(host.store.has('reports:session-2')).toBe(false);
  });
});

describe('/reports from shell writes', () => {
  const shell = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command });

  test('a deliverable a shell command writes counts, and its page shows over its card', async ($, on) => {
    const card = `${HOME}/reports/plans/2026-03-10-0900-plan.md`;
    const page = `${HOME}/reports/plans/2026-03-10-0900-plan.html`;
    const render = `bun explainer.ts render body.md > ${page} && sed -i '' 's/a/b/' ${card}`;
    setUp(on, machine({ shellWrites: { [render]: [page, card] } }));
    await shell($, render);
    expect(await listed($)).toBe(list('reports/plans/2026-03-10-0900-plan.html · 2026-03-10-0900-plan.md'));
  });

  test('reads a quoted path with spaces, a redirect and an assignment as the shell does', async ($, on) => {
    const spaced = `${HOME}/projects/acme/kick off.md`;
    const redirected = `${HOME}/reports/plans/redirected.md`;
    const assigned = `${HOME}/reports/plans/assigned.html`;
    const command = `cp draft.md "${spaced}" && echo x >${redirected}; P=${assigned}&& render > "$P"`;
    setUp(on, machine({ shellWrites: { [command]: [spaced, redirected, assigned] } }));
    await shell($, command);
    expect(await listed($)).toBe(
      list(
        'projects/acme/kick off.md · kick off.md',
        'reports/plans/redirected.md · redirected.md',
        'reports/plans/assigned.html · assigned.html'
      )
    );
  });

  test('a command that only reads a report, or writes state, adds nothing', async ($, on) => {
    const report = `${HOME}/reports/plans/old.md`;
    const readme = `${HOME}/projects/acme/README.md`;
    const host = setUp(on, machine({ shellWrites: { [`echo x >> ${readme}`]: [readme] } }));
    host.files[report] = 'x';
    await shell($, `cat ${report}`);
    await shell($, `echo x >> ${readme}`);
    expect(await listed($)).toBe(EMPTY);
  });

  test('a denied command adds nothing, even when its path was modified meanwhile', async ($, on) => {
    on('tool.call', { tool: 'Bash' }, () => ({ deny: 'not allowed' }));
    const report = `${HOME}/reports/plans/fresh.md`;
    const host = setUp(on);
    host.files[report] = 'x';
    host.mtimes[report] = host.clock.now();
    await shell($, `echo x > ${report}`);
    expect(await listed($)).toBe(EMPTY);
  });

  test('outside an agent home, matching commands ask the CLI once a minute at most', async ($, on) => {
    const host = setUp(on, machine({ isHome: false }));
    const pings = () => host.argv.filter((args) => args.slice(2).join(' ') === 'ping').length;
    await shell($, 'ls /elsewhere/projects/app.md');
    await shell($, 'ls /elsewhere/projects/web.md');
    await drainSaves($);
    expect(pings()).toBe(1);
    await host.clock.advance(61_000);
    await shell($, 'ls /elsewhere/projects/api.md');
    await drainSaves($);
    expect(pings()).toBe(2);
  });

  test('a command naming no deliverable folder costs no process, filesystem or store calls', async ($, on) => {
    const host = setUp(on);
    await shell($, 'git -C /elsewhere/app status');
    await drainSaves($);
    expect(host.argv).toEqual([]);
    expect(host.fsCalls).toEqual([]);
    expect(host.store.size).toBe(0);
  });
});

describe('/reports attach', () => {
  const USAGE = 'Usage: /reports, or /reports attach <path> [<path> …] (quote a path with spaces)';

  test('attaches several files in one go, by relative, home-relative or absolute path, in order', async ($, on) => {
    const host = setUp(on);
    host.files[`${HOME}/knowledge/concepts/fixture.md`] = 'x';
    host.files[`${USER_HOME}/Downloads/statement.pdf`] = 'x';
    host.files['/fixture/elsewhere/notes.txt'] = 'x';
    expect(
      await listed($, 'attach knowledge/concepts/fixture.md ~/Downloads/statement.pdf  /fixture/elsewhere/notes.txt')
    ).toBe(
      list(
        'knowledge/concepts/fixture.md · fixture.md',
        `${USER_HOME}/Downloads/statement.pdf · statement.pdf`,
        '/fixture/elsewhere/notes.txt · notes.txt'
      )
    );
  });

  test('keeps a path with spaces whole when quoted, single-quoted, escaped, or quoted in part', async ($, on) => {
    const host = setUp(on);
    host.files[`${HOME}/projects/acme/meeting  notes.md`] = 'x';
    host.files[`${HOME}/projects/acme/kick off.md`] = 'x';
    host.files[`${USER_HOME}/My Docs/q3 plan.md`] = 'x';
    host.files[`${USER_HOME}/My Docs/budget.md`] = 'x';
    const args = `attach "projects/acme/meeting  notes.md" 'projects/acme/kick off.md' ~/My\\ Docs/q3\\ plan.md ~/"My Docs"/budget.md`;
    expect(await listed($, args)).toBe(
      list(
        'projects/acme/meeting  notes.md · meeting  notes.md',
        'projects/acme/kick off.md · kick off.md',
        `${USER_HOME}/My Docs/q3 plan.md · q3 plan.md`,
        `${USER_HOME}/My Docs/budget.md · budget.md`
      )
    );
  });

  test('attaches the files that exist and names the ones that do not', async ($, on) => {
    const host = setUp(on);
    host.files[`${HOME}/knowledge/concepts/fixture.md`] = 'x';
    const result = await run($, 'reports', 'attach missing.md knowledge/concepts/fixture.md "gone away.md"');
    expect(result.text).toBe('No file at missing.md, gone away.md');
    expect(result.context?.[0]).toBe(list('knowledge/concepts/fixture.md · fixture.md'));
  });

  test('refuses a missing file, a missing path and an unknown word', async ($, on) => {
    setUp(on);
    expect((await run($, 'reports', 'attach missing.md')).text).toBe('No file at missing.md');
    expect((await run($, 'reports', 'attach')).text).toBe(USAGE);
    expect((await run($, 'reports', 'list')).text).toBe(USAGE);
    expect((await run($, 'reports', 'attach ""')).text).toBe(USAGE);
    expect(await listed($)).toBe(EMPTY);
  });

  test('refuses an unclosed quote instead of splitting the path', async ($, on) => {
    const host = setUp(on);
    host.files[`${HOME}/off.md`] = 'x';
    expect((await run($, 'reports', 'attach "projects/acme/kick off.md')).text).toBe(
      'A quote isn\'t closed in: attach "projects/acme/kick off.md'
    );
    expect(await listed($)).toBe(EMPTY);
  });
});

describe('reports row', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows the reports above the prompt until dismissed on ${surface}`, async ($, on) => {
      setUp(on);
      await writeReport($, 'briefings', 'morning', 'Morning brief');
      expect((await bandTexts($, surface)).join('')).not.toContain('📎');
      await run($, 'reports');
      const texts = await bandTexts($, surface);
      expect(texts).toContain('📎 Reports');
      expect(texts).toContain('· 1 in this conversation');
      expect(texts).toContain('reports/briefings/2026-03-10-0900-morning.md');
      expect(texts).toContain('Morning brief');
      await (await band($, surface)).press({ key: 'reports:dismiss' });
      expect((await bandTexts($, surface)).join('')).not.toContain('📎');
    });
  }

  test('shows the latest five and counts the rest', async ($, on) => {
    setUp(on);
    for (const index of [1, 2, 3, 4, 5, 6, 7]) {
      await writeReport($, 'plans', `plan-${index}`, `Plan ${index}`);
    }
    await run($, 'reports');
    const texts = await bandTexts($);
    expect(texts).toContain('   +2 earlier');
    expect(texts).not.toContain('Plan 2');
    expect(texts).toContain('Plan 3');
    expect(texts).toContain('Plan 7');
  });

  test('an open row picks up a report that lands after it', async ($, on) => {
    setUp(on);
    await writeReport($, 'briefings', 'morning', 'Morning brief');
    await run($, 'reports');
    await writeReport($, 'plans', 'spec', 'Final spec');
    expect(await untilBandShows($, 'Final spec')).toContain('Final spec');
  });

  test('/clear takes the row down', async ($, on) => {
    setUp(on);
    await writeReport($, 'briefings', 'morning', 'Morning brief');
    await run($, 'reports');
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } });
    expect((await bandTexts($)).join('')).not.toContain('📎');
  });
});
