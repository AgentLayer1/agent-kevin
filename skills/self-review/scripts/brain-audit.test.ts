import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBuffer } from '../../../mcp-server/src/knowledge/utils';
import { runtimeDirName } from '../../../mcp-server/src/shared/naming';

const SCRIPT = join(import.meta.dir, 'brain-audit.ts');
const TODAY = '2026-10-31';
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const daysAgo = (days: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

interface TaskSeed {
  id: string;
  project: string;
  status?: string;
  updated: number;
  created?: number;
}

/** A home with tasks, session day-files, a memory index, an archive, articles, and a watermark. */
const home = () => {
  const root = mkdtempSync(join(tmpdir(), 'brain-audit-'));
  dirs.push(root);
  const write = (rel: string, content: string) => {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  };
  write(join(runtimeDirName(), 'version.json'), '{}');
  write('SOUL.md', '# Soul\n');
  const task = ({ id, project, status = 'open', updated, created = updated }: TaskSeed) =>
    write(
      `projects/${project}/tasks/${id}-task.md`,
      `---\nschema: 1\nid: ${id}\ntitle: Task ${id}\nstatus: ${status}\npriority: P2\nproject: ${project}\ncreated: ${daysAgo(created)}\nupdated: ${daysAgo(updated)}\ndue: \n---\n\n## Description\n\nx\n`
    );
  const session = (days: number, turns: string) =>
    write(`knowledge/raw/sessions/${daysAgo(days)}.md`, `# Session Log\n\n${turns}\n`);
  const run = () => {
    const proc = spawnSync(process.execPath, [SCRIPT, '--home', root, '--today', TODAY]);
    if (proc.status !== 0) throw new Error(proc.stderr.toString());
    return JSON.parse(proc.stdout.toString());
  };
  const age = (rel: string, days: number) => {
    const when = new Date(Date.parse(`${daysAgo(days)}T12:00:00Z`));
    utimesSync(join(root, rel), when, when);
  };
  return { write, task, session, run, age };
};

describe('brain-audit', () => {
  test('a task is stale from 30 days untouched, and dormant only when no operator turn names it for 60', () => {
    const { task, session, run } = home();
    task({ id: 'ac-001', project: 'acme', updated: 29 });
    task({ id: 'ac-002', project: 'acme', updated: 30 });
    task({ id: 'ac-003', project: 'acme', updated: 31 });
    task({ id: 'ac-004', project: 'acme', status: 'done', updated: 90 });
    session(10, '**User:** where is ac-002?\n\n**Assistant:** ac-003 is still overdue.');
    const stale = run().tasks.stale.map((row: { id: string; dormant: boolean }) => `${row.id}:${row.dormant}`);
    expect(stale).toEqual(['ac-003:true', 'ac-002:false']);
  });

  test('an old active task counts while still touched and until kept, and a project goes dormant on both clocks', () => {
    const { write, task, session, run } = home();
    task({ id: 'ac-001', project: 'acme', status: 'active', updated: 5, created: 61 });
    task({ id: 'ac-002', project: 'acme', status: 'active', updated: 5, created: 59 });
    task({ id: 'ac-003', project: 'acme', status: 'active', updated: 5, created: 90 });
    write(
      join(runtimeDirName(), 'review.json'),
      JSON.stringify({ asked: { 'task:ac-003': { date: daysAgo(5), answer: 'keep' } } })
    );
    task({ id: 'ta-001', project: 'tax', updated: 70 });
    task({ id: 'sl-001', project: 'sleepy', updated: 70 });
    session(5, '**User:** fix the syntax, and check sleepy today');
    const audit = run();
    expect(audit.tasks.activeOld.map((row: { id: string }) => row.id)).toEqual(['ac-001']);
    expect(audit.projects.dormant.map((row: { slug: string }) => row.slug)).toEqual(['tax']);
  });

  test('memory lines rank closed, then quiet, then the rest; Keep silences an unchanged line; CRLF parses', () => {
    const { write, task, session, run } = home();
    task({ id: 'ac-001', project: 'acme', status: 'done', updated: 1 });
    task({ id: 'ac-002', project: 'acme', updated: 1 });
    task({ id: 'ac-003', project: 'acme', updated: 1 });
    session(3, '**User:** ac-002 next');
    session(20, '**User:** ac-003 next');
    const kept = '- **Itinerary** — rewrite the template.';
    write(
      'knowledge/memory/index.md',
      `# Memory\n\n## Active Threads\n\n- **No id** — prose only.\n- **Live** (ac-002) — moving.\n- **Quiet** (ac-003) — waiting.\n- **Shipped** (ac-001) — done.\n\n## Pending\n\n${kept}\n- **Insurance** — quote it.\n\n## Key Context\n\n- The API endpoint moved.\n\n## Open Questions\n\n- **[stale]** an old gap\n- **[missing]** a new one\n`.replace(
        /\n/g,
        '\r\n'
      )
    );
    write(
      join(runtimeDirName(), 'review.json'),
      JSON.stringify({
        asked: { [`memory:Pending:${hashBuffer(kept)}`]: { date: daysAgo(10), answer: 'keep', hash: hashBuffer(kept) } }
      })
    );
    const { memory } = run();
    const texts = (rows: { text: string }[]) => rows.map((row) => row.text);
    expect(memory.threads.map((row: { signal: string }) => row.signal)).toEqual(['closed', 'quiet', 'none', 'none']);
    expect(texts(memory.pending)).toEqual(['- **Insurance** — quote it.']);
    expect(texts(memory.keyContext)).toEqual(['- The API endpoint moved.']);
    expect(texts(memory.openQuestions)).toEqual(['- **[stale]** an old gap']);
  });

  test('unsettled archived decisions from 90 days, stale articles, and old captures grouped by month', () => {
    const { write, run, age } = home();
    const settledLine = `- **${daysAgo(25)}** — settled by an earlier pass.`;
    write(
      'knowledge/memory/archive/decisions-2026-10.md',
      `# Decisions\n\n- **${daysAgo(5)}** — not reached yet.\n${settledLine}\n- **${daysAgo(95)}** — outside the window.\n- ${daysAgo(6)} — an older, unbolded entry.\n`
    );
    write(
      join(runtimeDirName(), 'review.json'),
      JSON.stringify({ asked: { [`decision:${hashBuffer(settledLine)}`]: { date: daysAgo(20), answer: 'leave' } } })
    );
    write('knowledge/concepts/old-idea.md', `---\ntitle: Old\nupdated: ${daysAgo(61)}\n---\n\nbody\n`);
    write('knowledge/concepts/fresh-idea.md', `---\ntitle: Fresh\nupdated: ${daysAgo(59)}\n---\n\nbody\n`);
    write('reports/captures/.env', 'SECRET=1');
    write('reports/captures/shot.png', 'png');
    write('reports/captures/old-a.png', 'a');
    write('reports/captures/old-b.pdf', 'bb');
    write('reports/captures/old-frames/frame-1.png', 'f');
    write('reports/captures/new-frames/frame-1.png', 'n');
    age('reports/captures/old-a.png', 40);
    age('reports/captures/old-b.pdf', 40);
    age('reports/captures/old-frames/frame-1.png', 40);
    age('reports/captures/old-frames', 40);
    age('reports/captures/new-frames', 40);
    const audit = run();
    expect(audit.decisions.map((row: { date: string }) => row.date)).toEqual([daysAgo(6), daysAgo(5)]);
    expect(audit.articles.map((row: { path: string }) => row.path)).toEqual(['knowledge/concepts/old-idea.md']);
    expect(audit.storage.captures).toEqual([
      {
        key: `capture:${daysAgo(40).slice(0, 7)}`,
        hash: '',
        month: daysAgo(40).slice(0, 7),
        files: ['reports/captures/old-a.png', 'reports/captures/old-b.pdf'],
        folders: ['reports/captures/old-frames'],
        bytes: 4
      }
    ]);
  });
});
