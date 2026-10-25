/**
 * Wrap third-party content (originating outside the daemon's trust boundary —
 * web pages, scrapes, external API responses) so the model treats it as data,
 * not instruction. Reach for this whenever a new boundary-crossing source is
 * added. Any wrapper tag spelled inside the label or content is defused, so the
 * source can't close the wrap early and speak outside it.
 *
 * Inputs the system is *designed* to absorb (user feedback, session logs,
 * people artifacts you dropped yourself) intentionally do NOT use this — the
 * wrap conflicts with the compile pipeline's purpose of extracting facts and
 * preferences from those sources.
 *
 * The marker is descriptive, not a sandbox — it works because the model has
 * been trained to honor untrusted-content delimiters.
 */
const WRAPPER_TAG = /<(\s*\/?\s*untrusted-source)/gi;

const defuse = (text: string): string => text.replace(WRAPPER_TAG, '&lt;$1');

export function untrusted(label: string, content: string): string {
  const safeLabel = defuse(label).replace(/"/g, '&quot;');
  return `<untrusted-source label="${safeLabel}">\n${defuse(content)}\n</untrusted-source>`;
}
