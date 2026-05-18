/**
 * Split large session logs into compile-sized chunks at natural boundaries
 * so each compile prompt stays under the MCP tool-response cap.
 *
 * Primary boundary: `### Session (...)` and `### Pre-Compact (...)` headers —
 * the delimiters used by `session-capture.ts` when appending entries.
 * Splitting between entries keeps every entry intact.
 *
 * Secondary boundary: `**User:**` / `**Assistant:**` turn markers within an
 * oversized entry. A single multi-turn entry can easily exceed the cap (long
 * design discussions, post-compact continuations). Without sub-splitting,
 * `chunkSessionLog` would emit an oversized chunk that busts the MCP cap and
 * gets diverted to a disk file the model can't consume.
 */

/**
 * Match the start of a session-capture entry. Used both for finding the
 * first entry (so we can pull out the file-level header) and for splitting
 * the body into entry-aligned chunks.
 */
const ENTRY_HEADER_RE = /^### (?:Session|Pre-Compact) \(/m;

/** Split an entry into single-turn pieces at `\n\n**User:**` / `\n\n**Assistant:**` boundaries. */
const splitTurns = (entry: string): string[] => {
  const pieces = entry.split(/(?=\n\n\*\*(?:User|Assistant):\*\*)/);
  return pieces.filter((p) => p.length > 0);
};

/**
 * If `entry` fits, return [entry]. Otherwise split on turn boundaries and
 * re-accumulate into entry-sized pieces. The first piece keeps the original
 * `### Session (...)` header; subsequent pieces get a `_(continuation N of M)_`
 * marker so the synthesizer knows they're mid-entry, not a new session.
 */
const splitOversizedEntry = (entry: string, targetBytes: number): string[] => {
  if (Buffer.byteLength(entry, 'utf-8') <= targetBytes) return [entry];

  const turns = splitTurns(entry);
  if (turns.length <= 1) return [entry]; // unsplittable — emit as-is, oversize accepted

  const headerEndIdx = turns[0].indexOf('\n\n**');
  const sessionHeader = headerEndIdx >= 0 ? turns[0].slice(0, headerEndIdx) : turns[0];
  const firstTurnTail = headerEndIdx >= 0 ? turns[0].slice(headerEndIdx) : '';
  const remainingTurns = [firstTurnTail, ...turns.slice(1)].filter((t) => t.length > 0);

  const pieces: string[][] = [[]];
  let currentBytes = Buffer.byteLength(sessionHeader, 'utf-8');

  for (const turn of remainingTurns) {
    const turnBytes = Buffer.byteLength(turn, 'utf-8');
    if (currentBytes + turnBytes > targetBytes && pieces[pieces.length - 1].length > 0) {
      pieces.push([]);
      currentBytes = 0;
    }
    pieces[pieces.length - 1].push(turn);
    currentBytes += turnBytes;
  }

  const total = pieces.length;
  return pieces.map((turns, i) =>
    i === 0
      ? sessionHeader + turns.join('')
      : `${sessionHeader}\n\n_(continuation ${i + 1} of ${total})_${turns.join('')}`
  );
};

/**
 * Return one or more compile-ready chunks. If `content` fits within
 * `targetBytes`, returns a single-element array with the original content.
 * Otherwise splits at entry boundaries (and, when an entry alone is bigger
 * than the cap, at turn boundaries inside the entry) and prepends the file
 * header + "Part N of M" annotation so the LLM treats it as a partial slice.
 *
 * Pure: deterministic, no I/O.
 */
export function chunkSessionLog(content: string, targetBytes: number): string[] {
  if (Buffer.byteLength(content, 'utf-8') <= targetBytes) return [content];

  const firstIdx = content.search(ENTRY_HEADER_RE);
  if (firstIdx < 0) return [content]; // no entry markers — can't split sensibly

  const fileHeader = content.slice(0, firstIdx).trimEnd();
  const body = content.slice(firstIdx);

  // Lookahead split keeps the entry header at the start of each piece.
  const entries = body.split(/(?=^### (?:Session|Pre-Compact) \()/m).filter((e) => e.length > 0);

  // Expand oversized entries into multiple sub-entries split on turn boundaries.
  const sized = entries.flatMap((entry) => splitOversizedEntry(entry, targetBytes));

  const chunkEntries: string[][] = [[]];
  let currentBytes = 0;

  for (const entry of sized) {
    const entryBytes = Buffer.byteLength(entry, 'utf-8');
    if (currentBytes + entryBytes > targetBytes && chunkEntries[chunkEntries.length - 1].length > 0) {
      chunkEntries.push([]);
      currentBytes = 0;
    }
    chunkEntries[chunkEntries.length - 1].push(entry);
    currentBytes += entryBytes;
  }

  const total = chunkEntries.length;
  return chunkEntries.map((parts, i) => {
    const note = `_(Part ${i + 1} of ${total} — earlier parts may have already updated wiki articles; check existing articles before creating new ones.)_`;
    const head = fileHeader ? `${fileHeader}\n\n${note}\n\n` : `${note}\n\n`;
    return (head + parts.join('')).trimEnd();
  });
}
