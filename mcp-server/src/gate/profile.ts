import { homedir } from 'node:os';
import { join } from 'node:path';

interface ProfileInput {
  /** Real paths (symlinks resolved): Seatbelt matches the resolved path, so `/var/...` never matches `/private/var/...`. */
  checkout: string;
  scratch: string;
  network: 'loopback' | 'open';
  /** Ports already listening when the step starts (dev database, API, containers): all refused but `allowedPorts`. */
  listening: number[];
  /** The services the gate started for this run (a throwaway database): the only listening ports a step may reach. */
  allowedPorts?: number[];
  extraWritable?: string[];
  home?: string;
}

/**
 * A Seatbelt profile no wider than the Bash sandbox: writes only to the checkout, a scratch dir and `extraWritable`,
 * no secrets, no
 * signals outside itself, no Apple Events. Network is allow-listed, since Seatbelt lets a wildcard allow beat a
 * narrower deny: the run's own services and the free ephemeral ports a step's own workers bind (Turbopack's pool),
 * never a service already listening; an install adds HTTPS and DNS.
 */
export const sandboxProfile = ({
  checkout,
  scratch,
  network,
  listening,
  allowedPorts = [],
  extraWritable = [],
  home = homedir()
}: ProfileInput): string =>
  [
    '(version 1)',
    '(allow default)',
    '',
    '(deny file-write*)',
    `(allow file-write* ${[checkout, scratch, ...extraWritable].map(subpath).join(' ')} ${DEVICE_WRITES})`,
    // Untracked and run outside any sandbox later (git hooks, git config, editor and agent settings).
    `(deny file-write* ${[join(checkout, '.git'), ...EXECUTED_LATER.map((name) => join(checkout, name))].map(subpath).join(' ')})`,
    '',
    `(deny file-read* ${SECRET_DIRS.map((dir) => subpath(join(home, dir))).join(' ')} ${SECRET_FILES.map((file) => literal(join(home, file))).join(' ')} ${SECRET_PATTERNS.map((pattern) => `(regex #"${pattern}")`).join(' ')})`,
    '(allow file-read* (regex #"/\\.env\\.example$"))',
    '',
    '(deny network-outbound)',
    ...allowPorts([...new Set([...allowedPorts, ...freeEphemeralPorts(listening)])]),
    ...(network === 'open'
      ? [
          '(allow network-outbound (remote ip "*:443") (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))'
        ]
      : []),
    '',
    '(deny signal)',
    '(allow signal (target same-sandbox))',
    '(deny appleevent-send)',
    '(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd") (global-name "com.apple.coreservices.quarantine-resolver"))',
    ''
  ].join('\n');

/** Claude Code's own sandbox read denials, and a few more, so a gate step reads nothing a Bash call couldn't. */
const SECRET_DIRS = [
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.kube',
  join('.config', 'gh'),
  join('Library', 'Keychains'),
  '.claude'
];
const SECRET_FILES = [
  '.git-credentials',
  '.npmrc',
  '.pypirc',
  join('.docker', 'config.json'),
  '.netrc',
  join('.gem', 'credentials')
];
/** Anywhere on disk: keys and certificates, secrets and credentials folders, wallets, and .env files. */
const SECRET_PATTERNS = [
  '\\.pem$',
  '\\.key$',
  '/secrets(/|$)',
  '/credentials(/|$)',
  '/\\.state/secrets(/|$)',
  '/Library/Application Support/.*/(metamask|electrum|exodus|phantom|solflare)[^/]*(/|$)',
  '/\\.env(\\.[^/]+)?$'
];
const EXECUTED_LATER = ['.vscode', '.idea', '.claude', '.mcp.json', '.husky'];

const quote = (path: string): string => `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const subpath = (path: string): string => `(subpath ${quote(path)})`;
const literal = (path: string): string => `(literal ${quote(path)})`;

/**
 * Ports in macOS's ephemeral range (where a bind to port 0 lands) that nothing was listening on when the step started.
 */
const freeEphemeralPorts = (listening: number[]): number[] => {
  const taken = new Set(listening);
  return Array.from({ length: EPHEMERAL_LAST - EPHEMERAL_FIRST + 1 }, (_, index) => EPHEMERAL_FIRST + index).filter(
    (port) => !taken.has(port)
  );
};

// One rule naming all ~16k ports fails to compile ("profile compilation failed"); 64 per rule compiles in ~4.7 s.
const allowPorts = (ports: number[]): string[] =>
  Array.from(
    { length: Math.ceil(ports.length / PORTS_PER_RULE) },
    (_, index) =>
      `(allow network-outbound ${ports
        .slice(index * PORTS_PER_RULE, (index + 1) * PORTS_PER_RULE)
        .map((port) => `(remote ip "localhost:${port}")`)
        .join(' ')})`
  );

const PORTS_PER_RULE = 64;

// net.inet.ip.portrange.first / .last on macOS.
const EPHEMERAL_FIRST = 49152;
const EPHEMERAL_LAST = 65535;

const DEVICE_WRITES = [
  literal('/dev/null'),
  literal('/dev/zero'),
  literal('/dev/dtracehelper'),
  '(regex #"^/dev/tty")',
  '(regex #"^/dev/fd/")'
].join(' ');
