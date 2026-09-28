/**
 * Structured data a generated page carries inline, in `<script type="application/json" id="…">`,
 * so any feature can read the page's data without running it.
 */

export type JsonBlockRead = { kind: 'data'; data: unknown; raw: string } | { kind: 'invalid'; error: string };

const SCRIPT_UNSAFE = /<\/|<!--/g;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

const assertJson = (value: unknown, path: string): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJson(item, `${path}[${index}]`));
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => assertJson(item, `${path}.${key}`));
  } else if (!(value === null || typeof value === 'boolean' || typeof value === 'string' || Number.isFinite(value))) {
    const kind = typeof value === 'number' || value === undefined ? String(value) : `a ${typeof value}`;
    throw new Error(`${path} is ${kind}, which JSON can't hold`);
  }
};

/** Pretty JSON that can't end or confuse the script element holding it; throws on anything JSON can't carry. */
export const serializeJson = (value: unknown, root: string): string => {
  assertJson(value, root);
  return JSON.stringify(value, null, 2).replace(SCRIPT_UNSAFE, (unsafe) => (unsafe === '</' ? '<\\/' : '<\\u0021--'));
};

/** Whether hand-written block text keeps `</` and `<!--` escaped. */
export const isScriptSafe = (raw: string): boolean => raw.search(SCRIPT_UNSAFE) === -1;

export const jsonBlock = (id: string, value: unknown, root: string): string =>
  `<script type="application/json" id="${id}">\n${serializeJson(value, root)}\n</script>`;

/** null when the page has no block with this id. */
export const readJsonBlock = (html: string, id: string): JsonBlockRead | null => {
  const block = new RegExp(`<script\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
  if (!block) {
    return null;
  }
  try {
    return { kind: 'data', data: JSON.parse(block[1]), raw: block[1] };
  } catch (err) {
    return { kind: 'invalid', error: err instanceof Error ? err.message : String(err) };
  }
};
