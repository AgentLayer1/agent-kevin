import { describe, expect, test } from 'bun:test';
import { RUNTIME_DIR, agentEnvPrefix, agentKeyName } from './naming';

describe('agentEnvPrefix', () => {
  // The fork seam, asserted in one place — every other test builds key names
  // from the prefix and the runtime dir from the constant, so a fork updates
  // these lines and nothing else.
  test('derives KEVIN_ from this plugin manifest (agent-kevin)', () => {
    expect(agentEnvPrefix()).toBe('KEVIN_');
    expect(agentKeyName('CODE_PATH')).toBe('KEVIN_CODE_PATH');
  });

  test("this agent's runtime dir is .kevin", () => {
    expect(RUNTIME_DIR).toBe('.kevin');
  });
});
