/**
 * video_frames + media_transcribe — thin MCP wrappers around `extractFrames`
 * (@/media/frames) and `transcribe` (@/media/transcribe).
 *
 * The MCP server runs outside the Bash command sandbox, so ffmpeg here reads
 * videos in seatbelt-protected dirs (~/Downloads, ~/Desktop, ~/Documents) that
 * ffmpeg-under-Bash can't — same sandbox-escape as browser_flows/setup_worktree.
 * The module owns the extraction logic; this file just declares the tool.
 */

import { extractFrames } from '@/media/frames';
import { transcribe } from '@/media/transcribe';
import { log as baseLog } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { z } from 'zod';

const log = baseLog.tools.with('media');

export const tools: ToolDef[] = [
  defineTool({
    name: 'video_frames',
    description:
      "Extract still frames from a LOCAL video file for visual analysis, running outside the Bash sandbox so it can read videos in ~/Downloads, ~/Desktop, ~/Documents (which ffmpeg-under-Bash can't). Default mode 'scene' returns only frames where the picture changed (ideal for screen recordings of a flow — one frame per step, no redundant near-duplicates); 'interval' samples every N seconds; 'count' returns N evenly-spaced frames; 'at' grabs one frame at each of the given seconds (e.g. the moments a transcript points at). Frames are downscaled and capped (maxFrames) so they don't flood context. Requires ffmpeg on PATH (`brew install ffmpeg`). Returns { dir, mode, count, frames: [{path, t, label}] } — Read the frame paths to see them.",
    inputSchema: {
      video: z.string().describe('Path to a local video (absolute, relative, ~-expanded, or file:// URL).'),
      mode: z.enum(['scene', 'interval', 'count', 'at']).optional().describe("Extraction strategy (default 'scene')."),
      threshold: z
        .number()
        .optional()
        .describe('scene mode: change sensitivity 0-1 (default 0.3; lower = more frames).'),
      everySeconds: z.number().optional().describe('interval mode: seconds between frames (default 5).'),
      count: z.number().int().optional().describe('count mode: number of evenly-spaced frames (default 12).'),
      times: z.array(z.number().nonnegative()).optional().describe('at mode: seconds to grab, e.g. [12, 73.5].'),
      maxFrames: z.number().int().optional().describe('Hard cap on frames returned (default 30).'),
      width: z.number().int().optional().describe('Downscale frames to this max width in px (default 1280).'),
      name: z.string().optional().describe('Output folder name hint.'),
      dir: z
        .string()
        .optional()
        .describe(
          "Existing folder under reports/captures (e.g. media_transcribe's `dir`); frames go in a new subfolder of its frames/."
        )
    },
    handler: async (args) => {
      const result = extractFrames(args);
      log.info(`${result.mode} → ${result.count} frames in ${result.dir}`);
      return result;
    }
  }),
  defineTool({
    name: 'media_transcribe',
    description:
      "Transcribe the speech in a LOCAL audio or video file, on-device (macOS 26+ via `yap`, `brew install yap`; audio never leaves the machine). Runs outside the Bash sandbox so it reads files in ~/Downloads, ~/Desktop, ~/Documents. Writes transcript.md ('[mm:ss] text' per line) and transcript.json (segments with start/end seconds) to a new folder under reports/captures, and returns their paths — Read transcript.md to see it. Pass that folder as video_frames' `dir` to keep the video's frames beside it.",
    inputSchema: {
      file: z
        .string()
        .describe('Path to a local audio or video file (absolute, relative, ~-expanded, or file:// URL).'),
      language: z
        .string()
        .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'a BCP-47 tag such as en-US')
        .optional()
        .describe(
          "BCP-47 language spoken in the file (default 'en-US'). Unsupported languages return the engine's error."
        ),
      name: z.string().optional().describe('Output folder name hint.')
    },
    handler: async (args) => {
      const result = await transcribe(args);
      log.info(`${result.engine} ${result.language} → ${result.segmentCount} segments in ${result.dir}`);
      return result;
    }
  })
];
