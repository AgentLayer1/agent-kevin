/**
 * The operator's channel map, `<knowledge>/concepts/slack-channels.md`: which channels it lists, so
 * a channel joined since the map was last edited can be flagged instead of going unchecked.
 */
import { FOLDERS } from '@/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BULLET = /^\s*[-*]\s+`?#?([A-Za-z0-9][\w.-]*)`?/;

/**
 * Every channel name or id listed under a `##` section, so prose bullets above the first section don't count.
 */
export const parseChannelMap = (markdown: string): Set<string> => {
  const lines = markdown.split('\n');
  const firstSection = lines.findIndex((line) => line.startsWith('## '));
  return new Set(
    firstSection === -1
      ? []
      : lines.slice(firstSection).flatMap((line) => {
          const name = BULLET.exec(line)?.[1];
          return name ? [name] : [];
        })
  );
};

export const readChannelMap = (): Set<string> | undefined => {
  const file = resolve(FOLDERS.CONCEPTS, 'slack-channels.md');
  return existsSync(file) ? parseChannelMap(readFileSync(file, 'utf8')) : undefined;
};

export const unmappedChannels = (
  membership: ReadonlyArray<{ id: string; name: string }>,
  listed: ReadonlySet<string>
): string[] =>
  membership
    .filter((channel) => !listed.has(channel.name) && !listed.has(channel.id))
    .map((channel) => channel.name)
    .sort((left, right) => left.localeCompare(right));
