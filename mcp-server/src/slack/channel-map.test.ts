import { describe, expect, test } from 'bun:test';
import { parseChannelMap, unmappedChannels } from './channel-map';

const MAP = `---
title: Slack Channels
---

# Slack Channels

- this-intro-bullet — not a channel

## External
- ext-acme — Acme Corp
- \`ext-globex\`
- #ext-initech

## Team
* team-eng
- C0TEAMID

## Uncategorized
`;

describe('parseChannelMap', () => {
  test('reads bullets under sections, tolerating backticks, # and notes', () => {
    expect([...parseChannelMap(MAP)].sort()).toEqual(['C0TEAMID', 'ext-acme', 'ext-globex', 'ext-initech', 'team-eng']);
  });

  test('a file with no section lists nothing', () => {
    expect(parseChannelMap('# Slack Channels\n\n- ext-acme\n').size).toBe(0);
  });
});

describe('unmappedChannels', () => {
  test('only channels the map lists by neither name nor id come back, sorted', () => {
    const membership = [
      { id: 'C1', name: 'ext-umbrella' },
      { id: 'C2', name: 'ext-acme' },
      { id: 'C0TEAMID', name: 'team-ops' },
      { id: 'C3', name: 'announcements' }
    ];
    expect(unmappedChannels(membership, parseChannelMap(MAP))).toEqual(['announcements', 'ext-umbrella']);
  });
});
