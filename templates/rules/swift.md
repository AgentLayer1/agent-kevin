---
paths:
  - "**/*.swift"
---

# Swift Rules

- Use value types (`struct`, `enum`) over `class` unless reference semantics are needed.
- Prefer `let` over `var`. Immutability by default.
- Use Swift concurrency (`async`/`await`, `Actor`) over GCD and completion handlers.
- Leverage `Codable` for serialization. Avoid manual JSON parsing.
- Use `Result` and typed throws over optional error returns.
- Prefer protocol-oriented design over deep class hierarchies.
- Use `@Observable` macro (Observation framework) over `ObservableObject`/`@Published` for new code.
- Guard clauses (`guard let`) for early exits over nested `if let`.
- No force unwraps (`!`) unless the value is guaranteed at compile time (e.g., static URLs).
- No `Any` or `AnyObject` without justification.

## Concurrency

- **Never reach for `@unchecked Sendable` to silence a diagnostic.** It hides the race instead of
  fixing it. Use an actor, a value type, or a `sending` parameter. The one legitimate use is a type
  with internal locking that is provably thread-safe, and it carries a comment naming the invariant.
- Prefer structured concurrency (task groups) over unstructured `Task {}`. When an API offers both
  an `async` and a closure-based variant, take the `async` one.
- **System delegates are not all main-thread.** Check the framework's contract before isolating a
  witness. Some callbacks arrive on the framework's own queue, so those witnesses are `nonisolated`;
  isolating them trips the runtime executor check on the first callback and the process dies at
  launch. Others do arrive on main, and their conformance can be declared `@preconcurrency`.
- **A closure written inside a `@MainActor` type inherits that isolation.** Combine's `map`,
  `filter`, `handleEvents` and `sink` are called on whatever queue the upstream emits on, so a chain
  without a `.receive(on: .main)` hop ahead of it traps and kills the process. Completion handlers
  are the same case: a closure handed to an API that calls back on its own queue traps unless the
  parameter is declared `@Sendable`, which makes the caller's closure nonisolated. Declare
  completions `@Sendable` on any helper a `@MainActor` type will call, and touch the model inside
  through `Task { @MainActor in ... }`. Async protocol witnesses are immune; synchronous ones are not.
- Prefer per-instance Combine subjects. Static ones leak events between instances.
- If code spans several targets or packages, compare their concurrency build settings before
  assuming the behavior should match.

## Testing (Swift Testing)

- Suites are **structs**, not classes, unless subclassing or a `deinit` is genuinely needed. Any
  type holding `@Test` functions is already a suite: add `@Suite` only to name it or attach traits.
- Use `init()` (and `deinit` on classes) instead of `setUp()`/`tearDown()`. A suite's initializer
  must take no parameters, so stored properties need defaults or a custom `init`.
- No `test` prefix on test names. `userCanLogOut()` reads better than `testUserCanLogOut()`.
- **Tests run in parallel and in random order**, so a suite must share no mutable state.
- `#expect(isLoggedIn == false)`, never `#expect(!isLoggedIn)`: negation defeats the macro expansion
  and the failure message becomes useless.
- **`try #require(...)` before comparing an optional.** `#expect(x?.y == z)` traps the runner with
  `EXC_BREAKPOINT` when `x` is nil. Hoist the `try` out of the comparison: `#expect(a == try #require(b))`
  does not parse.
- `#expect` has no tolerance form. Write `#expect(abs(a - b) <= tolerance)`.
- Wrap a real, tracked bug in `withKnownIssue("<task-id>: ...")` rather than deleting or inverting
  the assertion. It fails if the issue *stops* happening. `isIntermittent: true` flips that for a
  flaky case being actively debugged.
- Prefer parameterized tests, but note that two argument collections form a Cartesian product. Pass
  `zip(a, b)` when you want pairwise.
- Bug fixes land with a failing test first.

## Time is an input

Never call `Date()` or `.now` inside date-sensitive logic. Simulators cannot fast-forward the clock,
so behavior is only testable at a fixed instant if time flows in as a parameter.

## Toolchain

Build, test and run through the `xcode` MCP server, never a sandboxed shell. See the `xcode` rule
for the loop and the repo's own `AGENTS.md` for its per-project shape.

## Further reading

Deeper, area-specific guidance lives in separately-authored MIT skills rather than here, so this
rule stays short enough to be followed. Install the ones a project actually needs via
`/agent-kevin:configure-skills` → third-party libraries:

- [Swift Concurrency](https://github.com/twostraws/Swift-Concurrency-Agent-Skill),
  [Swift Testing](https://github.com/twostraws/Swift-Testing-Agent-Skill) and
  [SwiftUI](https://github.com/twostraws/SwiftUI-Agent-Skill) by Paul Hudson
- [Swift FormatStyle](https://github.com/n0an/Swift-FormatStyle-Agent-Skill) by Anton Novoselov, who
  also authors the App Intents and WidgetKit skills listed in the directory below
- [Swift API Design Guidelines](https://github.com/Erikote04/Swift-API-Design-Guidelines-Agent-Skill) by Erik Sebastián de Erice
- [Swift-Agent-Skills](https://github.com/twostraws/Swift-Agent-Skills), the directory the above are
  catalogued in, and [Swift Skills & Best Practices](https://github.com/Dimillian/Skills) by Thomas Ricouard

A third-party skill is prompt content injected into the session: read each one in full before
installing it, and prefer instruction-only skills with no tool or network directives.
