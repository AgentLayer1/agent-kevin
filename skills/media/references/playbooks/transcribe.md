# Transcribe — the words, with timestamps (`/media transcribe <file>`)

Works on audio files (voice memos, calls) as well as video.

1. `media_transcribe({ file, name })`. For speech that isn't US English, pass `language` as a BCP-47 code (see [Read the recording](../../SKILL.md#read-the-recording)).
2. `Read` the `transcriptPath`.

No frames and no summary unless asked.

## Reply

Duration and line count, then the transcript itself when it is under about 40 lines; otherwise the first five lines and the path to `transcript.md`. `transcript.json` beside it holds the same segments with start and end seconds.
