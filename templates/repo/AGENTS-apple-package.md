# {{PACKAGE_NAME}} — Agent Guide

<!--
  Scaffold for a Swift package repo, dropped by the Xcode pack
  (/agent-kevin:configure-skills → Xcode). Fill every {{PLACEHOLDER}} and delete
  any section that does not apply.

  Pair this file with:
    .claude/CLAUDE.md   containing exactly:  @../AGENTS.md
    .xcode-version      when the package is developed against a pinned Xcode

  Keep repo FACTS here. Style rules live in the agent home's .claude/rules/.
-->

{{ONE_PARAGRAPH: what the package is, who consumes it, its licence, and what it deliberately is
not.}} Default branch: `{{DEFAULT_BRANCH}}`.

## Layout

Pure SPM, `swift-tools-version: {{X.Y}}`, platforms {{macOS 12 / iOS 15 / ...}}. {{State the
language mode per target and any target that deliberately stays behind, with the reason.}}
{{Dependency policy: none, or the short list and why.}} Products:

- `{{Product}}` — {{what it covers}}{{ (depends on {{Other}})}}
- `{{Umbrella}}` — umbrella of the above

## Build & test

```sh
swift build
swift test
```

In Xcode, the shared `{{PACKAGE_NAME}}-Package` scheme runs `{{TEST_PLAN}}` at the package root
{{, with code coverage on for the library targets}}. **Agents open this package directory as a
workspace through the `xcode` MCP server and run the plan there**: sandboxed shells cannot run
SwiftPM directly, since it needs caches outside the sandbox.

{{Where tests live and how the target is wired (path, framework, shared helpers, resource bundles,
anything excluded from compilation).}} {{Any file that deliberately stays on XCTest, and why.}}

{{Assertion rules this suite has taught: optional unwrapping, tolerance comparisons, parse quirks.}}

Known environmental failures are wrapped in `withKnownIssue` so the suite reports them as expected
failures and a real regression still turns the run red: {{list them and what would retire each}}.

## Compatibility contract

{{If consumers may track a branch rather than a version:}} Consumers may depend on this package by
version or by tracking `{{DEFAULT_BRANCH}}`, so treat every push to `{{DEFAULT_BRANCH}}` as a
release: the suite must pass first, and a change to public API is a breaking change until every
product exposing it is considered. Prefer additive changes; when something public must change,
deprecate first where practical and call the break out in the commit message.

{{If the package is branch-tracked by an app, add: editing this checkout changes nothing in a
consuming app's build until that app re-resolves, unless the app pulls this package in through its
workspace as a local override.}}

## Conventions

- {{Documentation expectations for public API.}}
- {{How files are organised: by type extended, by product, by feature.}}
- {{The dependency stance, stated as a value rather than a rule.}}
- The platform floor outranks any skill's or guide's defaults: an API newer than the floor goes
  behind `#available` or a shim, and an existing public symbol is deprecated, never deleted.

## Toolchain

{{Delete if the package is not pinned.}} Pinned via `.xcode-version` (currently
{{XCODE_VERSION}}). If the installed Xcode does not match, stop and say so instead of building
against a different SDK.

## Pitfalls

<!-- Institutional memory. Every breakage and every hour lost gets a line here. -->

- {{OS-update or toolchain breakages this package has hit.}}
- SwiftLint runs as a {{non-fatal}} build phase (`.swiftlint.yml`); fix warnings in files you touch.
- **Never `cd` into a repo folder in a shell; use absolute paths.** Claude Code drops a
  `.claude/.cc-writes/` scratch directory wherever the shell sits.
