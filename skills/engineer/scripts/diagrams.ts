import { join } from 'node:path';

interface MermaidValidator {
  parseMermaid: (source: string) => Promise<{ ok: boolean; error?: string }>;
}

// mermaid resolves only at run time, through NODE_PATH; a non-literal path keeps tsc from following it.
const VALIDATOR = join(import.meta.dir, '..', '..', 'mermaid', 'scripts', 'validate.ts');

/** One error line per diagram that Mermaid can't parse, prefixed with its label. */
export const diagramErrors = async (diagrams: { label: string; source: string }[]): Promise<string[]> => {
  if (!diagrams.length) {
    return [];
  }
  const { parseMermaid }: MermaidValidator = await import(VALIDATOR);
  const results = await Promise.all(
    diagrams.map(async ({ label, source }) => {
      const result = await parseMermaid(source);
      return result.ok ? null : `${label}: diagram doesn't parse: ${result.error}`;
    })
  );
  return results.filter((result): result is string => result !== null);
};
