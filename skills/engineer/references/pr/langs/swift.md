# Swift addendum

Ported from `internal/config/rules/rule_docs/swift.md` in [alibaba/open-code-review](https://github.com/alibaba/open-code-review) (Apache-2.0, Copyright 2026 Alibaba), trimmed to the classes of defect this skill reports. Appended to the correctness, invariants, and security lane prompts when the changed files include `.swift`.

Report only defects that are real in changed code on a reachable path. Before reporting non-local behavior (threading, retain cycles, error contracts), read the owner, the callers, and the input source; never infer it from names or types. Do not duplicate what the compiler, SwiftLint, or the Xcode analyzer reports unless the diff creates a concrete correctness impact.

## Optionals and runtime failures

- Force unwrap, force cast, or `try!` on a runtime-derived value (user input, network, persistence, decoding, external state) where failure is reachable and unhandled.
- Implicitly unwrapped optionals outside a framework lifecycle pattern, where access can happen before initialization or after invalidation.
- Optional handling that turns a required failure into silent wrong behavior, missing data, or invalid state.

## Memory ownership and ARC

- An escaping closure stored by an object that strongly captures that object.
- `[unowned]` in an escaping closure where the object's lifetime is not guaranteed until execution.
- Delegate, observer, callback, timer, or task relationships that form an ownership cycle or keep working after the owner is gone.
- Combine subscriptions, async streams, notifications, or timers started without lifecycle cleanup, so they outlive dismissal or deallocation.

## Error handling

- A throwing call or `Result` failure ignored, replaced with a success value, or hidden where the failure changes behavior or data.
- `try?` that discards failure information a caller needs to distinguish.
- An empty `catch` that suppresses a failure affecting integrity, security, or user-visible behavior.
- `fatalError` or `preconditionFailure` on a recoverable runtime failure instead of typed propagation.

## Swift concurrency and isolation

- Mutable state crossing an actor boundary without isolation or synchronization where concurrent access is possible.
- A non-`Sendable` value crossing an isolation boundary; `@unchecked Sendable` or `nonisolated(unsafe)` added without a proven invariant.
- Actor-isolated state touched from a callback, delegate, or closure that dropped the isolation.
- A fire-and-forget `Task` that outlives its owner, cannot be cancelled, or keeps producing side effects after the lifecycle ends; a detached task where inherited context, priority, or cancellation was required.
- Async work that ignores cancellation and continues expensive computation or side effects.
- A continuation that can resume twice, never resume, or resume after its owner is invalid.
- A lock held, or a synchronous wait, across an `await`.
- Independent async operations run sequentially where the latency is user-visible.

## SwiftUI state and lifecycle

- View-owned reference state recreated on every render because the ownership wrapper is wrong.
- A dynamic collection keyed on unstable identity, so rows reuse the wrong state.
- Side effects in `body` or a computed property, so they run on every render.
- `.task` work that continues after disappearance where cancellation was required; `.task(id:)` missing where a replaced input lets a stale result overwrite a newer one.
- UI state mutated off the main actor where concurrent updates are possible.
- A user-visible string added or changed without localization coverage.

## Persistence (SwiftData / Core Data)

- A write that leaves stored state partially updated after a failure.
- A schema or relationship change with no migration for existing data; a relationship change that orphans objects or changes delete behavior.
- A `@Query` or fetch predicate that matches the wrong rows or forces an avoidable expensive fetch.
- A cached or persisted value treated as authoritative when it can go stale and affect correctness.

## Health, purchases, and privacy

- HealthKit access without authorization handling or a safe fallback; health or sensitive data written to logs, analytics, or plaintext storage; a health claim with no supporting source.
- Purchase, restore, or entitlement flows that mishandle pending, offline, or verification outcomes; a missing or mis-scoped transaction listener; paywall UI reading stale state instead of the canonical entitlement.

## Networking, web views, and external input

- Tokens, credentials, or sensitive data exposed through logs, storage, or requests; weakened transport or certificate validation where an existing boundary depends on it.
- Retry logic with no backoff, so transient failures become request storms; a cache that serves stale or unauthorized responses.
- Client-controlled identity, authorization, or payment values trusted without server validation.
- A `WKWebView` bridge accepting unvalidated messages or exposing privileged actions; a navigation handler or deep link that changes authenticated state or triggers a sensitive action without validation.

## Performance and unsafe interop

- Expensive synchronous work on the main actor that blocks interaction; repeated expensive work on a hot path; unbounded growth in a collection, cache, or set of retained tasks.
- Unsafe pointer, buffer, or memory APIs used without guaranteed lifetime or bounds; Objective-C or C bridging that violates ownership, nullability, or lifetime assumptions.

## Tests

- A test that relies on `sleep` or timing instead of awaiting the work directly.
- Tests sharing mutable global state, or depending on network, time, locale, or global persistence where isolation was required.
- An async test that leaves tasks running after it completes.
- An assertion that cannot fail for the regression it claims to pin.
