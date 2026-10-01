# Remember — a recording into the brain (`/media remember <file>`)

1. Run [summarize](summarize.md), unless this session already wrote a `summary.md` for this file.
2. If a frame showed customer data or anything private, ask before saving: the brain keeps what it is given.
3. `capture({ text, title, label: 'media' })`, where `text` is the summary followed by a `## Transcript` section holding `transcript.md`'s lines, and `title` is the summary's title.
4. `duplicate: true` means this recording was already captured: say so, and that nothing new was written.

Don't run the compile; the next sync or `/agent-kevin:knowledge-compile` absorbs it.

## Reply

The title saved, the inbox path `capture` returned, and the next compile as the step that files it.
