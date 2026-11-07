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
 * no secrets, no signals outside itself, no Apple Events. Network is loopback only, and never to a service that
 * was already listening unless it is one of the run's own: one allow rule that requires-not each refused port, since
 * Seatbelt lets a broad allow beat a narrower deny. An install adds HTTPS and DNS.
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
    loopbackExcept(listening.filter((port) => !allowedPorts.includes(port))),
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

// Listing each allowed port instead (all ~16k free ephemeral ones) compiled in ~4.7 s per step.
const loopbackExcept = (refused: number[]): string =>
  `(allow network-outbound (require-all (remote ip "localhost:*")${refused.map((port) => ` (require-not (remote ip "localhost:${port}"))`).join('')}))`;

const DEVICE_WRITES = [
  literal('/dev/null'),
  literal('/dev/zero'),
  literal('/dev/dtracehelper'),
  '(regex #"^/dev/tty")',
  '(regex #"^/dev/fd/")'
].join(' ');
