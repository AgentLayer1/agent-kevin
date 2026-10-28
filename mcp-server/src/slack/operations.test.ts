import { expect, test } from 'bun:test';
import { getWhoami } from './operations';

test('an agent never signed in to Slack reads as not connected rather than an error', async () => {
  expect(await getWhoami()).toMatchObject({ connected: false });
});
