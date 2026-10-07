import type { Register } from 'claude-code';

import { registerCommands } from '../commands/commands';
import { registerManuals } from '../manuals/manuals';
import { registerSync } from '../sync/tracker';

export const register: Register = (on) => {
  registerManuals(on);
  registerSync(on);
  registerCommands(on);
};
