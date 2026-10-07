import type { Register } from 'claude-code';

import { registerCommands } from '../commands/commands';
import { registerSync } from '../sync/tracker';

export const register: Register = (on) => {
  registerSync(on);
  registerCommands(on);
};
