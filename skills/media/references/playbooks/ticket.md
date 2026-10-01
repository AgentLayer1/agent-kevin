# Ticket — a bug-report video into repro steps (`/media ticket <file>`)

A reporter recorded the problem and talked over it. Turn that into what an engineer needs to reproduce it.

1. Follow [Read the recording](../../SKILL.md#read-the-recording). Lean on the frames the narration points at: that is where the bug is.
2. If the operator pasted the ticket's text, or gave a link your tools can read, read it too and note where the video and the ticket disagree.
3. `Write` `ticket.md` into the capture folder:

```markdown
# <the problem in one line, as the reporter would say it>

<source path> · <duration mm:ss>

## Steps to reproduce
1. <action> (00:08)
2. …

## Expected vs actual
- **Expected:** <what the reporter said should happen; mark it *inferred* when they never said it>
- **Actual:** <what happened, with the timestamp>

## Evidence
- <on-screen error text, URL, screen name, app or browser version, device> (00:41, frames/<file>.png)

## Questions for the reporter
- <what the recording doesn't show: account, environment, how often it happens>
```

Stop at the report. Root cause is the engineer skill's work: when the operator asks for it, hand over `ticket.md` as the starting point.

## Reply

The one-line problem, the step count, the number of open questions, and the path to `ticket.md`.
