import type { Register } from 'claude-code';

import { registerCommands } from '../commands/commands';
import { registerManuals } from '../manuals/manuals';
import { registerNotices } from '../notices/notices';
import { registerQueue } from '../queue/queue';
import { registerReports } from '../reports/reports';
import { registerSetup } from '../setup/setup';
import { registerSync } from '../sync/tracker';

export const register: Register = (on) => {
  registerManuals(on);
  registerReports(on);
  registerSync(on);
  registerCommands(on);
  registerNotices(on);
  registerQueue(on);
  registerSetup(on);
};
