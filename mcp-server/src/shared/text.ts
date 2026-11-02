import { readFileSync } from 'node:fs';

export const toLf = (text: string): string => text.replace(/\r\n/g, '\n');

/**
 * A text file with LF line endings, whatever it was saved with: Git for Windows checks files out
 * with CRLF by default, and editors on Windows keep or add it.
 */
export const readText = (path: string): string => toLf(readFileSync(path, 'utf-8'));
