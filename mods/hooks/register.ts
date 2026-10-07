import type { Register } from 'claude-code';

import { registerCommands } from '../commands/commands';

export const register: Register = (on) => {
  registerCommands(on);
};
