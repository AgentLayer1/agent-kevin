# Trace forensics

**You own the diagnosis from an artifact someone already captured:** a CPU profile, a trace, a spindump, a heap snapshot. It is a fixed dataset. Read it; don't re-run it. [Runtime forensics](runtime-forensics.md) is the live-process version.

1. **Identify the format and load it** with the right tool. Parse large artifacts in a subagent and keep the reduced finding in the main thread.
2. **Make it queryable before reading it.** Dump the trace or snapshot into sqlite, one row per sample, frame, or node ([build the lever](../principles/build-the-lever.md)).
3. **Narrow to the cause.** Query for the frames holding the most time and walk the call tree to the hot path. For a leak, follow the retainer chain to a root. For a spindump, find the thread stuck on-CPU or blocked, and its wait reason.
4. **Attribute to source:** map the hot frame to file, symbol, and line using the artifact's own symbols. A frame with no source mapping is not yet a diagnosis; resolve the symbols or say plainly the artifact doesn't carry them.
5. **Confirm against a paired capture** when one exists: diff before against after. Without one, call the finding the strongest hypothesis the artifact supports, not a confirmed cause.

**Reply:** the artifact and its format, the reduced finding, the source location, the artifact paths, and whether a paired capture confirmed it. No fix unless asked.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) trace-forensics playbook (MIT, Copyright (c) 2026 Lauren Tan).
