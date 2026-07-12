/**
 * video_frames — thin MCP wrapper around `extractFrames` (see @/media/frames).
 *
 * The MCP server runs outside the Bash command sandbox, so ffmpeg here reads
 * videos in seatbelt-protected dirs (~/Downloads, ~/Desktop, ~/Documents) that
 * ffmpeg-under-Bash can't — same sandbox-escape as browser_flows/setup_worktree.
 * The module owns the extraction logic; this file just declares the tool.
 */

import { extractFrames } from '@/media/frames';
import { log as baseLog } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { z } from 'zod';

const log = baseLog.tools.with('video');

export const tools: ToolDef[] = [
  defineTool({
    name: 'video_frames',
    description:
      "Extract still frames from a LOCAL video file for visual analysis, running outside the Bash sandbox so it can read videos in ~/Downloads, ~/Desktop, ~/Documents (which ffmpeg-under-Bash can't). Default mode 'scene' returns only frames where the picture changed (ideal for screen recordings of a flow — one frame per step, no redundant near-duplicates); 'interval' samples every N seconds; 'count' returns N evenly-spaced frames. Frames are downscaled and capped (maxFrames) so they don't flood context. Requires ffmpeg on PATH (`brew install ffmpeg`). Returns { dir, mode, count, frames: [{path, t, label}] } — Read the frame paths to see them.",
    inputSchema: {
      video: z.string().describe('Path to a local video (absolute, relative, ~-expanded, or file:// URL).'),
      mode: z.enum(['scene', 'interval', 'count']).optional().describe("Extraction strategy (default 'scene')."),
      threshold: z
        .number()
        .optional()
        .describe('scene mode: change sensitivity 0-1 (default 0.3; lower = more frames).'),
      everySeconds: z.number().optional().describe('interval mode: seconds between frames (default 5).'),
      count: z.number().int().optional().describe('count mode: number of evenly-spaced frames (default 12).'),
      maxFrames: z.number().int().optional().describe('Hard cap on frames returned (default 30).'),
      width: z.number().int().optional().describe('Downscale frames to this max width in px (default 1280).'),
      name: z.string().optional().describe('Output folder name hint.')
    },
    handler: async (args) => {
      const result = extractFrames(args);
      log.info(`${result.mode} → ${result.count} frames in ${result.dir}`);
      return result;
    }
  })
];
