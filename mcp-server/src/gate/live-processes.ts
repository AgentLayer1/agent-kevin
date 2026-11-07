import { isInside } from '@/shared/paths';
import { sep } from 'node:path';

interface LiveProcess {
  pid: number;
  pgid: number;
  command: string;
}

/**
 * Dev tooling already running in `checkout` (a `pnpm dev`, a manual scenario run, another agent's tests):
 * a gate that rebuilds underneath it breaks it. Matched by cwd or by a path in its arguments.
 */
export const busyProcesses = (checkout: string, ownGroups: ReadonlySet<number>): LiveProcess[] => {
  const ps = Bun.spawnSync(['/bin/ps', '-axww', '-o', 'pid=,pgid=,command='], { timeout: 15_000 });
  if (ps.exitCode !== 0) {
    throw new Error(
      `Can't list processes to check ${checkout} is idle (ps exited ${ps.exitCode}); refusing to gate blind.`
    );
  }
  const candidates = devToolCandidates(ps.stdout.toString(), ownGroups, process.pid);
  // lsof over every process takes about a second; only the dev-tool candidates need their cwd read, often none.
  const lsofCwd = candidates.length
    ? Bun.spawnSync(
        ['/usr/sbin/lsof', '-a', '-nP', '-d', 'cwd', '-p', candidates.map(({ pid }) => pid).join(','), '-Fpn'],
        { timeout: 15_000 }
      ).stdout.toString()
    : '';
  return busyFrom({ checkout, candidates, lsofCwd });
};

/**
 * Dev-tool processes from `ps -axww -o pid=,pgid=,command=` output, other than this server and its own gate groups.
 */
export const devToolCandidates = (ps: string, ownGroups: ReadonlySet<number>, self: number): LiveProcess[] =>
  ps
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .flatMap((match) => (match ? [{ pid: Number(match[1]), pgid: Number(match[2]), command: match[3] ?? '' }] : []))
    .filter(({ pid, pgid, command }) => pid !== self && !ownGroups.has(pgid) && DEV_TOOL.test(command));

/**
 * The candidates working in `checkout`, by cwd (`lsof -d cwd -Fpn` output) or by a path in their arguments.
 */
export const busyFrom = ({
  checkout,
  candidates,
  lsofCwd
}: {
  checkout: string;
  candidates: LiveProcess[];
  lsofCwd: string;
}): LiveProcess[] => {
  const cwdInside = new Set(
    parseLsofCwd(lsofCwd)
      .filter(({ cwd }) => isInside(cwd, checkout))
      .map(({ pid }) => pid)
  );
  return candidates.filter(({ pid, command }) => cwdInside.has(pid) || command.includes(`${checkout}${sep}`));
};

/**
 * The tools whose output a gate rewrites. Editors' language servers (tsserver, eslint) are not among them, and
 * neither is bun: every agent session's MCP server is a bun process.
 */
const DEV_TOOL =
  /(^|[/\s])(pnpm|npm|npx|yarn|turbo|nest|next|next-server|vite|webpack|wrangler|vitest|jest|tsc|tsx|ts-node|prisma|dotenv|scenario\.[cm]js)(\.[cm]?js)?(\s|$)/;

const parseLsofCwd = (output: string): { pid: number; cwd: string }[] =>
  output.split('\n').reduce<{ rows: { pid: number; cwd: string }[]; pid?: number }>(
    (state, line) => {
      if (line.startsWith('p')) {
        return { ...state, pid: Number(line.slice(1)) };
      }
      if (line.startsWith('n') && state.pid !== undefined) {
        return { ...state, rows: [...state.rows, { pid: state.pid, cwd: line.slice(1) }] };
      }
      return state;
    },
    { rows: [] }
  ).rows;
