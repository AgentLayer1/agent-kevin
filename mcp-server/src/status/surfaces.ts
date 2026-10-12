import { FILES, FOLDERS } from '@/config';
import { isInside } from '@/shared/paths';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { titleize } from './format';

export interface Pin {
  icon: string | undefined;
  title: string;
  /** As written in pinned.md, relative to reports/. */
  href: string;
  path: string;
  exists: boolean;
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

/** The pin lines in reports/pinned.md, in file order, each file once. A pin that no longer points
 *  at a file in the home stays in the list with `exists: false`. */
export const readPins = (): Pin[] => {
  const body = existsSync(FILES.REPORTS_PINNED) ? readFileSync(FILES.REPORTS_PINNED, 'utf-8') : '';
  const pins = [...body.matchAll(PIN_LINE)].map(([, icon, title, href]) => {
    const path = resolve(FOLDERS.REPORTS, targetPath(href));
    const exists = isInside(path, FOLDERS.HOME) && (statSync(path, { throwIfNoEntry: false })?.isFile() ?? false);
    return { icon, title, href, path, exists };
  });
  return pins.filter((pin, index) => pins.findIndex((other) => other.path === pin.path) === index);
};

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
