/**
 * I/O wrapper for the HTML Agent OS dashboard: collect a fresh snapshot,
 * render (html-render.ts, pure), write atomically to `<HOME>/index.html`.
 * Kept separate from the renderer so tests can exercise the rendering without
 * importing @/config (whose KEVIN_HOME freezes at first evaluation).
 */
import { FILES } from '@/config';
import { writeFileAtomic } from '@/shared/utils';
import { collectStatus } from './collect';
import { renderDashboardHtml } from './html-render';

/** Collect a fresh snapshot and write the dashboard to `<HOME>/index.html`. */
export const writeDashboardHtml = async (): Promise<{ path: string; bytes: number }> => {
  const html = renderDashboardHtml(await collectStatus());
  writeFileAtomic(FILES.DASHBOARD, html);
  return { path: FILES.DASHBOARD, bytes: Buffer.byteLength(html) };
};
