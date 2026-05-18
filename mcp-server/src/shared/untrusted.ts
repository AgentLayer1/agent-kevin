/**
 * Wrap third-party content (originating outside the daemon's trust boundary —
 * web pages, scrapes, external API responses) so the model treats it as data,
 * not instruction. Today's only consumer is the SerpAPI provider; reach for
 * this whenever a new boundary-crossing source is added.
 *
 * Inputs the system is *designed* to absorb (user feedback, session logs,
 * people artifacts you dropped yourself) intentionally do NOT use this — the
 * wrap conflicts with the compile pipeline's purpose of extracting facts and
 * preferences from those sources.
 *
 * The marker is descriptive, not a sandbox — it works because the model has
 * been trained to honor untrusted-content delimiters.
 */
export function untrusted(label: string, content: string): string {
  const safeLabel = label.replace(/"/g, '&quot;');
  return `<untrusted-source label="${safeLabel}">\n${content}\n</untrusted-source>`;
}
