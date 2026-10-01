# Screenshots — still frames from a video (`/media screenshots <file>`)

Pick the `video_frames` mode from the ask:

| Ask | Call |
|---|---|
| "grab screenshots", "the key moments" | `{ video, mode: 'scene' }` (the default: one frame per screen change) |
| "frame at 1:13", "at 0:20 and 2:05" | `{ video, mode: 'at', times: [73] }`, converting `mm:ss` to seconds |
| "a screenshot every 10 seconds" | `{ video, mode: 'interval', everySeconds: 10 }` |
| "give me 6 screenshots" | `{ video, mode: 'count', count: 6 }` |

Pass `dir` when an earlier call in this session already made a capture folder for the same video, so everything stays together.

`Read` the frames only when the operator wants them looked at, not just saved.

## Reply

One line per frame (`mm:ss` and its file name), then the folder path.
