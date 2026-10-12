import { atom, read, update } from 'claude-code';
import type { EngineInterface, On } from 'claude-code';

import { DATA_DIR, HOME_MARKERS, parentOf } from '../manuals/repo';

const needsSetup = atom({ plugin: 'agent-kevin', key: 'needsSetup' } as const, false);

const selfAndAncestors = (dir: string): string[] => (dir === '/' ? [] : [dir, ...selfAndAncestors(parentOf(dir))]);

const exists = ($: EngineInterface, path: string): Promise<boolean> =>
  $.fs.stat(path).then(
    () => true,
    () => false
  );

/**
 * No data dir at the root or above it holds a home marker and no SOUL.md sits at the root, so init has nothing
 * to overwrite and won't nest a home inside one. Read from disk rather than the CLI, which refuses to run
 * outside a home and needs the plugin's packages installed.
 */
async function isFresh($: EngineInterface): Promise<boolean> {
  const root = await $.session.root();
  const legacyDir = `.${$.plugin.name.replace(/^agent-/, '')}`;
  const paths = [
    `${root}/SOUL.md`,
    ...selfAndAncestors(root).flatMap((folder) =>
      [DATA_DIR, legacyDir].flatMap((dir) => HOME_MARKERS.map((marker) => `${folder}/${dir}/${marker}`))
    )
  ];
  return !(await Promise.all(paths.map((path) => exists($, path)))).includes(true);
}

async function check($: EngineInterface): Promise<void> {
  const isNew = await isFresh($);
  await update($, needsSetup, () => isNew);
  if (isNew) {
    void $.prompt.suggest({ text: `/${$.plugin.name}:init` });
  }
}

async function runInit($: EngineInterface): Promise<void> {
  const command = `${$.plugin.name}:init`;
  await update($, needsSetup, () => false);
  void $.command.run({ command }).catch(() => $.prompt.submit({ text: `/${command}` }));
}

const agentName = (pluginName: string): string => {
  const slug = pluginName.replace(/^agent-/, '');
  return `${slug.charAt(0).toUpperCase()}${slug.slice(1)}`;
};

export const registerSetup = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const result = await next(e);
    $.clock.after(0, () => void check($));
    return result;
  });

  // Once init starts it owns the rest of the session: it either sets the folder up or stops to ask for a relaunch.
  on('skill.prompt', { skill: /(^|:)init$/ }, async ($, e, next) => {
    await update($, needsSetup, () => false);
    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    if (e.props.hasSurvey || !(await read($, needsSetup))) {
      return below;
    }
    const { Box, Button, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold>{`${agentName($.plugin.name)} isn't set up in this folder yet`}</Text>
          <Box marginLeft={2}>
            <Button key="setup:init" variant="primary" label="Set up" onPress={() => runInit($)} />
          </Box>
        </Box>
        {below}
      </Box>
    );
  });
};
