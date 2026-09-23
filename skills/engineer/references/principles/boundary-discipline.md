# Boundary discipline

**Apply when:** wiring validation, error handling, or framework adapters.

Validate, narrow, and handle errors at system boundaries. Trust internal code. Business logic lives in pure functions, and the shell stays thin and mechanical.

- **At the boundary** (CLI args, config files, env, network, external APIs, webhooks, IPC): validate, parse into domain types, return errors, and be defensive.
- **Inside:** typed data and propagated errors. No re-validation, and no nil checks deep in a chain the boundary already covered.
- **Across the boundary,** expose domain concepts, not the transport's private representation. Don't re-export wire, storage, or framework types through a public surface. Keep general mechanism inside and special-purpose policy at the edge.
- **Configuration is a boundary.** Read environment variables in one config module; nothing else touches `process.env` or its equivalent.
- **Time is a boundary.** Store and compute in UTC; convert to a time zone only at display.
- **Errors change shape at the edge.** Business errors are thrown by services; the transport layer (an HTTP controller, a CLI) maps them to status codes and messages.
- **A webhook's response code is its retry contract.** Acknowledge (2xx) only what was consumed. Return a retryable status for a transient failure; log and acknowledge a permanent one so it isn't retried forever.
- **Hand child processes a cleaned environment.** Strip known secrets with a blocklist, so dependencies you don't know about keep working.
- **Keep logic out of framework wiring** so it tests without the framework. Parsing takes raw input and returns typed state. Prompt construction takes state and returns a string. Scoring takes state and returns a result.

**The tests:**

- Is this data crossing a boundary right now? If not, the check is redundant.
- Can this be a pure function the shell just calls? Extract it.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-boundary-discipline` (MIT, Copyright (c) 2026 Lauren Tan).
