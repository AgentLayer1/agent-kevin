/** Every TCP port something on this machine is listening on, whoever owns it. */
export const listeningPorts = (): number[] => {
  const netstat = Bun.spawnSync(['/usr/sbin/netstat', '-an', '-p', 'tcp'], { timeout: 15_000 });
  // netstat exits 0 with an empty table when it can't read the socket list, which would block nothing.
  const stderr = netstat.stderr.toString().trim();
  if (netstat.exitCode !== 0 || stderr) {
    throw new Error(
      `Can't list listening ports (${stderr || `netstat exited ${netstat.exitCode}`}), so the gate can't tell which local services to block; refusing to run.`
    );
  }
  return parseListeners(netstat.stdout.toString());
};

/**
 * Ports from `netstat -an -p tcp` LISTEN rows, whose local address ends `.<port>` (`*.5432`, `127.0.0.1.8000`, `::1.3000`).
 */
export const parseListeners = (output: string): number[] =>
  [
    ...new Set(
      output
        .split('\n')
        .filter((line) => /\bLISTEN\b/.test(line))
        .map(
          (line) =>
            line
              .trim()
              .split(/\s+/)[3]
              ?.match(/\.(\d+)$/)?.[1]
        )
        .flatMap((port) => (port ? [Number(port)] : []))
    )
  ].sort((left, right) => left - right);
