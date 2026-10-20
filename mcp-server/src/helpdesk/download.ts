import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { DownloadedFile } from './types';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const fetchFile = async (url: string, name: string): Promise<DownloadedFile> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Attachment download failed (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment is ${bytes.byteLength} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte cap`);
  }
  return { name, contentType: response.headers.get('content-type') ?? 'application/octet-stream', bytes };
};

/** A file name that can't climb out of its folder or hide. */
export const safeName = (name: string): string =>
  basename(name.replace(/\\/g, '/'))
    .replace(/[^\w.\- ]/g, '_')
    .replace(/^\.+/, '') || 'attachment';

/** Writes into a fresh temp folder, never the home: attachments are users' data. */
export const saveToTemp = (file: DownloadedFile): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'helpdesk-')), safeName(file.name));
  writeFileSync(path, file.bytes);
  return path;
};
