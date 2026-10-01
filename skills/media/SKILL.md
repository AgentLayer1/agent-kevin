---
name: media
description: >
  Make sense of a local audio or video file: transcribe the speech on-device with timestamps, grab
  screenshots, summarize what was said and shown, turn a bug-report video into repro steps, or save
  a recording to the brain. Triggers on "what's in this video", "transcribe this voice memo",
  "summarize this recording", "the ticket has a video", "screenshot at 1:13", "remember this
  meeting", or /media.
allowed-tools: mcp__plugin_agent-kevin_kevin__media_transcribe, mcp__plugin_agent-kevin_kevin__video_frames, mcp__plugin_agent-kevin_kevin__capture, Read, Write, Edit, Glob
---

# Media

Turns a recording into something you can read: what was said (an on-device transcript with timestamps), what was on screen (frames), and what it adds up to. Works on screen recordings, ticket attachments, meetings, and voice memos.

## Help

`/media help` (or "what can you do with audio and video?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Start

1. **Get a local file.** The tools read a path on this machine (`~/Downloads`, `~/Desktop` and `~/Documents` all work). A link (a Loom, a ticket attachment) can't be fetched: ask the operator to download it and give the path.
2. Match the ask to a playbook below. A file with no other ask, or a bare `/media <file>`, is **summarize**.

## Playbooks

| Ask | Playbook |
|---|---|
| "what's in this video", "summarize this recording", `/media summarize` | [summarize](references/playbooks/summarize.md) |
| "the ticket has a video", "what's the bug in this video", `/media ticket` | [ticket](references/playbooks/ticket.md) |
| "transcribe this", a voice memo, "what did they say", `/media transcribe` | [transcribe](references/playbooks/transcribe.md) |
| "grab screenshots", "frame at 1:13", "a screenshot every 10 seconds", `/media screenshots` | [screenshots](references/playbooks/screenshots.md) |
| "save this to my brain", "remember this meeting", `/media remember` | [remember](references/playbooks/remember.md) |

## Read the recording

The summarize, ticket and remember playbooks start here. A transcript or frames this session already made for the same file are reused, not made again.

1. **Transcript.** `media_transcribe({ file, name })`, then `Read` its `transcriptPath`. The language defaults to `en-US`; when the operator says the speech is in another language, pass its BCP-47 code (`ar-SA`, `ms-MY`). An unsupported-language error is the engine's answer: relay it and stop.
2. **Frames** (video only; skip for audio files such as `.m4a`, `.mp3`, `.wav`):
   - `video_frames({ video: file, dir })` with the transcript's `dir`, for the moments the picture changed.
   - Then the moments the speaker points at the screen ("here", "this", "see", "look", an error, a number read aloud): `video_frames({ video: file, mode: 'at', times: [...], dir })` with those segments' start seconds, ten at most.
   - `Read` every frame.
3. **Timeline.** Line the two up by time: `mm:ss` · what was said · what was shown. A silent recording has an empty transcript; work from the frames and say so.

## Every time

- **Summaries are in English**, whatever language was spoken. A direct quote stays in the original language with an English gloss.
- **The source file stays where it is.** Never move, copy, rename or delete it; everything new lands in the capture folder the tools return.
- **On-camera secrets.** A key, token, password, `.env` content or customer record seen in a frame is never repeated in chat or in a written file: name what it was and its timestamp.
- **Missing dependency.** When a tool says `yap` or `ffmpeg` isn't installed (or the platform isn't supported), relay its message and stop.

## Reply

Each playbook names its output. Anything written ends with the capture folder's path.
