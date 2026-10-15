import { FILES, FOLDERS } from '@/config';
import { isInside } from '@/shared/paths';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { titleize } from './format';

export interface Pin {
  icon: string | undefined;
  title: string;
  /** As written in the pin line, relative to the file that holds it. */
  href: string;
  path: string;
  exists: boolean;
  /** The file the pin line lives in: reports/pinned.md or a project README. */
  source: string;
}

export interface SurfaceFile {
  kind: 'roadmap' | 'dashboard';
  title: string;
  path: string;
}

// `- 🗺️ [Title](plans/x.html)`: a `-` or `*` bullet, an optional icon (anything not starting with a
// letter, digit or markdown mark), a title that may hold [brackets], a target that may hold (parens).
const PIN_LINE = /^\s*[-*] +(?:([^\p{L}\p{N}\s*_[\]]\S*) +)?\[((?:[^[\]]|\[[^\]]*\])+)\]\(((?:[^()]|\([^()]*\))+)\)/gmu;

/** The file a link target names: `<…>` unwrapped, a `"title"`, `#anchor` and `?query` dropped, `%20` decoded. */
const targetPath = (href: string): string => {
  const bare = href.trim().replace(/^<(.*)>$/, '$1').replace(/\s+"[^"]*"$/, '').replace(/[#?].*$/, '');
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
};

// A project README's `## Pinned` section, up to the next `## ` heading or the end of the file.
const PINNED_SECTION = /^## Pinned[ \t]*$([\s\S]*?)(?=^## |(?![\s\S]))/m;

const readText = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf-8') : '');

/** The pin lines in `body`, in file order, each file once, links resolved against `source`'s folder.
 *  A pin that no longer points at a file in the home stays in the list with `exists: false`. */
const pinsIn = (source: string, body: string): Pin[] => {
  const pins = [...body.matchAll(PIN_LINE)].map(([, icon, title, href]) => {
    const path = resolve(dirname(source), targetPath(href));
    const exists = isInside(path, FOLDERS.HOME) && (statSync(path, { throwIfNoEntry: false })?.isFile() ?? false);
    return { icon, title, href, path, exists, source };
  });
  return pins.filter((pin, index) => pins.findIndex((other) => other.path === pin.path) === index);
};

/** The pins in reports/pinned.md. */
export const readPins = (): Pin[] => pinsIn(FILES.REPORTS_PINNED, readText(FILES.REPORTS_PINNED));

/** The pins in a project README's `## Pinned` section, which its card and focus page show. */
export const projectPins = (project: string): Pin[] => {
  const readme = resolve(FOLDERS.PROJECTS, project, 'README.md');
  return pinsIn(readme, PINNED_SECTION.exec(readText(readme))?.[1] ?? '');
};

/** A project README without its `## Pinned` section. */
export const withoutPins = (readme: string): string => readme.replace(PINNED_SECTION, '');

export interface PinLink {
  title: string;
  icon: string;
  /** HOME-relative. */
  path: string;
}

/** A project's pins whose file is there; a broken one is the brain audit's to flag. */
export const projectPinLinks = (project: string): PinLink[] =>
  projectPins(project)
    .filter((pin) => pin.exists)
    .map((pin) => ({ title: pin.title, icon: pin.icon ?? '📌', path: relative(FOLDERS.HOME, pin.path) }));

/** The pins whose file is there, which the sidebar and the session context show. */
export const livePins = (): Pin[] => readPins().filter((pin) => pin.exists);

/** The `hue:` (0–359) each project's README frontmatter sets, so the operator can pick a project's color. */
export const projectHues = (): Record<string, number> =>
  Object.fromEntries(
    (existsSync(FOLDERS.PROJECTS) ? readdirSync(FOLDERS.PROJECTS, { withFileTypes: true }) : [])
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const readme = resolve(FOLDERS.PROJECTS, entry.name, 'README.md');
        const front = existsSync(readme) ? /^---\n([\s\S]*?)\n---/.exec(readFileSync(readme, 'utf-8'))?.[1] : undefined;
        const hue = Number(/^hue:\s*(\d{1,3})\s*$/m.exec(front ?? '')?.[1]);
        return Number.isInteger(hue) && hue < 360 ? [[entry.name, hue] as const] : [];
      })
  );

/** The HOME-root roadmap.html, then every project's dashboard.html by title, whichever exist. */
export const surfaceFiles = (): SurfaceFile[] => {
  const roadmap: SurfaceFile[] = existsSync(FILES.ROADMAP)
    ? [{ kind: 'roadmap', title: 'Roadmap', path: FILES.ROADMAP }]
    : [];
  const dashboards: SurfaceFile[] = !existsSync(FOLDERS.PROJECTS)
    ? []
    : readdirSync(FOLDERS.PROJECTS, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          kind: 'dashboard' as const,
          title: titleize(entry.name),
          path: resolve(FOLDERS.PROJECTS, entry.name, 'dashboard.html')
        }))
        .filter((surface) => existsSync(surface.path))
        .sort((a, b) => a.title.localeCompare(b.title));
  return [...roadmap, ...dashboards];
};
