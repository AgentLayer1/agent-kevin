import { FILES, FOLDERS } from '@/config';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  /** The project's folder name for a dashboard; empty for the home roadmap. */
  slug: string;
  path: string;
}

/** `- [Title](plans/x.html)` lines in reports/pinned.md, an optional icon before the link, in
 *  file order. A pin whose file is gone stays in the list with `exists: false`. */
export const readPins = (): Pin[] => {
  const body = existsSync(FILES.REPORTS_PINNED) ? readFileSync(FILES.REPORTS_PINNED, 'utf-8') : '';
  return [...body.matchAll(/^- (?:(\S+) )?\[([^\]]+)\]\(([^)]+)\)/gm)].map(([, icon, title, href]) => {
    const path = resolve(FOLDERS.REPORTS, href);
    return { icon, title, href, path, exists: existsSync(path) };
  });
};

/** The HOME-root roadmap.html, then every project's dashboard.html, whichever exist. */
export const surfaceFiles = (): SurfaceFile[] => {
  const roadmap: SurfaceFile[] = existsSync(FILES.ROADMAP) ? [{ kind: 'roadmap', slug: '', path: FILES.ROADMAP }] : [];
  const dashboards: SurfaceFile[] = !existsSync(FOLDERS.PROJECTS)
    ? []
    : readdirSync(FOLDERS.PROJECTS, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          kind: 'dashboard' as const,
          slug: entry.name,
          path: resolve(FOLDERS.PROJECTS, entry.name, 'dashboard.html')
        }))
        .filter((surface) => existsSync(surface.path));
  return [...roadmap, ...dashboards];
};
