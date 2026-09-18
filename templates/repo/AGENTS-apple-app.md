# {{APP_NAME}} — Agent Guide

<!--
  Scaffold for an Xcode app repo, dropped by the Xcode pack
  (/agent-kevin:configure-skills → Xcode). Fill every {{PLACEHOLDER}} and delete
  any section that does not apply; a half-filled manual is worse than a short one.

  Pair this file with:
    .claude/CLAUDE.md   containing exactly:  @../AGENTS.md
    .xcode-version      containing the pinned Xcode version, e.g. 27.0

  Keep repo FACTS here. Style rules live in the agent home's .claude/rules/.
-->

{{ONE_PARAGRAPH: what the app is, which platforms, open or closed source, where a companion
package lives.}} Default branch: `{{DEFAULT_BRANCH}}` (PRs target it){{; note the release branch if
there is a second one}}.

## Targets

Single `{{PROJECT}}.xcodeproj`, {{N}} targets:

| Target | Product |
|---|---|
| {{TARGET_NAME}} | `{{PRODUCT}}.app` |
| {{EXTENSION_TARGET}} | `{{PRODUCT}}.appex` |

Deployment targets: {{iOS X.0, watchOS Y.0}}. Signing is {{automatic (team `{{TEAM_ID}}`)}};
simulator builds need no signing (`CODE_SIGNING_ALLOWED=NO` if it gets in the way).

## Schemes

All schemes are shared. The ones agents use:

- `{{SCHEME_DEBUG}}` (Debug) / `{{SCHEME_RELEASE}}` (Release)
- {{Per-extension or per-platform schemes, and any that deliberately do not exist.}}

## Settings & versioning

All build-setting overrides live in `{{CONFIG_DIR}}/*.xcconfig`. Never edit settings inside the
pbxproj. Version is single-sourced in `{{CONFIG_DIR}}/{{SHARED_XCCONFIG}}`:

```
MARKETING_VERSION = {{X.Y.Z}}
CURRENT_PROJECT_VERSION = {{BUILD}}
```

A release bump edits those two lines, always both (the build number must increase monotonically).
Releases are tagged `{{TAG_FORMAT}}` on the release commit.

## Dependencies

{{SPM only. Direct: ...}}. {{Name any first-party packages, their absolute paths, and the fact that
each has its own AGENTS.md so a fix belonging in the engine goes there, not here.}}

{{If any dependency is branch-tracked rather than semver-pinned, say so here and keep these:}}

- Never refresh package resolution as a side effect. Build with the committed `Package.resolved`
  (`-disableAutomaticPackageResolution`); resolve deliberately, in its own commit.
- **Develop through `{{PROJECT}}.xcworkspace`, not the bare project**, when it contains local package
  checkouts: Xcode treats a local package in the workspace as an override for the remote dependency
  of the same identity, so the project keeps its remote pins while workspace builds compile local
  sources. Opening the workspace rewrites the *package's* own `Package.resolved` with this app's
  graph; that drift is never committed (`git -C <pkg> checkout -- Package.resolved`).
- **Release order**: push the packages first, re-resolve so `Package.resolved` pins the new
  revisions (its own commit), then archive. An archive whose local packages have unpushed commits
  ships code no consumer can reproduce.

## Building & testing (agents)

Use **Apple's Xcode MCP server**, registered as `xcode` in the agent home, headless (Xcode 27+) so no
Xcode window is needed. A sandboxed shell cannot drive the toolchain on its own (xcrun cache
and CoreSimulator XPC are blocked; Codex's Seatbelt fails the same way); the home's
`sandbox.excludedCommands` entry lets `xcodebuild` and `simctl` run outside it for the two things
the MCP has no action for, archiving and simulator state. Everything else goes through the server.

The loop, verified on Xcode {{XCODE_VERSION}} ({{DATE}}): `XcodeOpenWorkspace` on
`{{PROJECT}}.xcworkspace` → `BuildProject` ({{approx times per platform}}) · `XcodeSwitchScheme` to
reach {{the other platform}} · `DeviceInteractionStartWorkspaceSession` →
`DeviceInteractionInstallAndRun` → `DeviceInteractionSynthesize` for boot, launch, screenshot and UI
hierarchy · `GetConsoleOutput` for logs · `RunAllTests`. Always `DeviceInteractionEndSession` when
done. Beyond the loop the server edits build settings, entitlements, Info.plist and String Catalogs,
adds targets from templates (`XcodeNewTarget`), renders SwiftUI previews and drives LLDB. Prefer all
of these over hand-editing the pbxproj.

Headless setup is one-time and sudo-gated: `sudo xcrun mcp-server enable` →
`sudo xcrun mcp-server allow-folder {{CODE_ROOT}} --always` → approve the agent id shown by
`xcrun mcp-server status` on first connect. "Not approved" or a `-32001` timeout means that step is
missing, not a broken loop. If a call returns an XPC error and the next says the workspace
identifier is unknown, the service has wedged: `sudo xcrun mcp-server stop`, reconnect the MCP
client, and `XcodeOpenWorkspace` again. Identifiers do not survive a restart.

Reference for unsandboxed contexts (CI, a plain terminal):

```sh
xcodebuild -project {{PROJECT}}.xcodeproj -scheme "{{SCHEME_DEBUG}}" \
  -destination 'generic/platform=iOS Simulator' build
```

{{Where the app's own tests live, which target, which framework, how the folder is wired
(synchronized group or explicit refs), which test plan runs them, and any rules the first suite
taught you.}}

## Verification ladder

"Compiles" is not "verified". Minimum rung per change class:

1. **Any change**: {{primary scheme}} builds.
2. **Shared code**: {{second platform}} scheme builds too.
3. **{{Core domain}} logic**: {{package}} tests green and app tests green.
4. **UI or behavior**: launch on simulator, screenshot, eyeball it.
5. **{{Widgets / extensions}}**: the simulator undersells these. Device dogfood by the operator
   before release; say so in the handoff.

Bug fixes land with a failing test first wherever the logic is testable.

## Concurrency

{{State the language mode and strict-concurrency posture, then the architecture's isolation
contract: which types are @MainActor, which protocol witnesses are deliberately nonisolated and
why, and any executor-check trap this codebase has already hit. This section is where hard-won
crash knowledge belongs; the agent home's swift rule carries only the general form.}}

## Toolchain

Pinned via `.xcode-version` (currently {{XCODE_VERSION}}). If the installed Xcode does not match,
stop and say so instead of building against a different SDK. Version bumps are a deliberate,
reviewed change.

## Time is an input

{{Delete if the app is not clock-sensitive.}} Simulators cannot fast-forward the clock. Never call
`Date()` or `.now` inside {{domain}} logic; time flows in as a parameter so behavior is testable at
any fixed instant.

## Pitfalls

<!-- Institutional memory. Every OS-update breakage and every hour lost gets a line here. -->

- {{The historical breakage zone on OS updates, so the next agent looks there first.}}
- SwiftLint runs as a {{non-fatal}} build phase (`.swiftlint.yml`); fix warnings in files you touch.
- {{How many targets share which folder, so membership is checked before assuming a file compiles
  into the target being edited.}}
- **One build driver at a time.** The operator's Xcode GUI and the headless MCP service are two Xcode
  instances sharing one project and one DerivedData; building in the GUI while the agent's workspace
  is open crashes Xcode in `IDEXCBuildServiceBuildOperation.performBuild()`. The agent closes its
  workspace (`XcodeCloseWorkspace`) before handing the project over.
- **Never `cd` into a repo folder in a shell; use absolute paths.** Claude Code drops a
  `.claude/.cc-writes/` scratch directory wherever the shell sits, and Xcode's "Convert to Folder"
  refuses any folder containing files the project does not reference (including Finder ghost folders
  holding only `.DS_Store`). Before converting, `find . -type d -name .cc-writes` and clear them.
