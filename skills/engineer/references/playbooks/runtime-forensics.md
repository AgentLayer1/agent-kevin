# Runtime forensics

**You own the diagnosis.** Instrument the live process instead of theorizing from source. The deliverable is a cited diagnosis, not a fix.

1. **Capture the live signal** on the matching surface: a CPU profile for a spinning process, a heap snapshot for a leak, a trace for a visual glitch. Browser apps go through the browser tools, Apple apps through the Xcode loop (console output, the debugger), servers and CLIs through their own profilers. A real artifact, not a guess.
2. **Reduce it to the smoking gun:** the function on the hot path, the retainer chain from the leaked object to a root, the loop firing without input. Parse large artifacts in a subagent and keep only the reduced finding ([guard the context window](../principles/guard-the-context-window.md)).
3. **Prove the mechanism before believing it.** Inject instrumentation or a temporary probe into the running process to confirm the hypothesis cheaply.
4. **Map it to source:** file, symbol, and the line that allocates or schedules.

**Reply:** the signal captured, the reduced finding, how the mechanism was proven, the source location, and the artifact paths. No fix unless asked; hand the cause to [bug fix](bug-fix.md) or [performance](perf.md).

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) runtime-forensics playbook (MIT, Copyright (c) 2026 Lauren Tan).
