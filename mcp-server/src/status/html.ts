/**
 * I/O wrapper for the HTML Agent OS dashboard: collect a fresh snapshot,
 * render (html-render.ts, pure), write atomically to `<HOME>/dashboard.html`.
 * Kept separate from the renderer so the rendering stays pure and testable without
 * touching the filesystem.
 */
import { FILES } from '@/config';
import { writeFileAtomic } from '@/shared/utils';
import { writeDashboard, type DashboardCounts } from '@/tasks/dashboard';
import { collectStatus } from './collect';
import { renderDashboardHtml } from './html-render';

/** Collect a fresh snapshot and write the dashboard to `<HOME>/dashboard.html`. */
export const writeDashboardHtml = async (): Promise<{ path: string; bytes: number }> => {
  const html = renderDashboardHtml(await collectStatus());
  writeFileAtomic(FILES.DASHBOARD, html);
  return { path: FILES.DASHBOARD, bytes: Buffer.byteLength(html) };
};

/** Rebuild both derived views — TASKS.md first (best-effort), then the HTML
 *  snapshot (the contract). Shared by the `dashboard` MCP tool and the CLI. */
export const rebuildDashboards = async (): Promise<{ path: string; bytes: number; tasks: DashboardCounts | null }> => {
  let tasks: DashboardCounts | null = null;
  try {
    tasks = writeDashboard();
  } catch {
    // TASKS.md is best-effort here — the HTML snapshot is the contract
  }
  return { ...(await writeDashboardHtml()), tasks };
};
