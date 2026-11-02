# Xcode & Apple Toolchain

Loaded unconditionally (no `paths:` frontmatter) because the rule that matters most fires
before any file is read: "build the app" is the moment the toolchain gets reached for.

## Route the toolchain through MCP

- **Build, test, run, screenshot and read logs through the `xcode` MCP server**, never through a
  sandboxed shell. The seatbelt blocks `xcrun`'s cache in `/var/folders`, CoreSimulator's XPC
  connection and SwiftPM's nested sandbox, so `xcodebuild`, `swift build/test` and `simctl` all die
  there. MCP servers run outside the sandbox, which is why the capability lives in one. Codex's
  Seatbelt fails identically, so this is architecture and not a Claude Code workaround.
- The loop: `XcodeOpenWorkspace` → `BuildProject` → `XcodeSwitchScheme` for another platform →
  `DeviceInteractionStartWorkspaceSession` → `DeviceInteractionInstallAndRun` →
  `DeviceInteractionSynthesize` (screenshot + UI hierarchy) → `GetConsoleOutput` → `RunAllTests`.
  Always `DeviceInteractionEndSession` when done. Open an SPM package's directory as a workspace to
  run its test plan.
- **Three shell exceptions**, and only when the home's settings carry the matching
  `sandbox.excludedCommands` entry: `simctl` for simulator state the MCP has no action for
  (location, erase, device list, creating and pairing devices), `xcodebuild archive` /
  `-exportArchive`, because the MCP surface has no archive action, and `xcrun xctrace` for
  profiling, because Instruments has no MCP action either (sandboxed, it dies creating its cache
  under `/var/folders`). Anything that uploads (`-exportArchive`, `altool`, `notarytool`) or deletes
  a simulator runtime is gated on the operator by a `permissions.ask` rule. Never widen the sandbox
  yourself.
- **An excluded command must be the whole command line.** The exclusion matches only a bare call:
  a leading `cd … &&` or a trailing `> log 2>&1` makes it run sandboxed, where it fails with package
  resolution `permissionDenied` and `simdiskimaged` errors. Pass absolute paths instead of `cd`, and
  capture output with `run_in_background` rather than a redirect.

## Headless setup and recovery

One-time, sudo-gated, and the operator's to run:

```sh
sudo xcrun mcp-server enable
sudo xcrun mcp-server allow-folder <code-root> --always
xcrun mcp-server status                 # prints the pending agent id on first connect
sudo xcrun mcp-server approve <id>      # each harness approves separately
```

"Not approved" or a `-32001` timeout means that chain is incomplete, not that the loop is broken.
A `-32000` on connect means headless mode is not enabled.

If a call returns an XPC error and the next says the workspace identifier is unknown, the headless
service has wedged: `sudo xcrun mcp-server stop` (unprivileged `stop` may not take), reconnect the
MCP client, then `XcodeOpenWorkspace` again. Workspace identifiers do not survive a restart.

## Ground rules

- **One build driver at a time.** The operator's Xcode GUI and the headless service are two Xcode
  instances sharing one project and one DerivedData. Building in the GUI while an agent workspace is
  open crashes Xcode in `IDEXCBuildServiceBuildOperation.performBuild()`. Close the agent's
  workspace (`XcodeCloseWorkspace`) before handing the project back. Leave the headless service
  itself running; stop it only when the operator says they are opening Xcode.
- **Read the repo's `AGENTS.md` first.** Targets, schemes, versioning source, dependency policy and
  the per-project build loop live there, not here.
- **`.xcode-version` is a stop sign.** If the installed Xcode does not match, say so and stop rather
  than build against a different SDK. Toolchain bumps are a deliberate, reviewed change.
- **"Compiles" is not "verified."** Build every affected scheme, run the tests, launch and look at
  it. Widgets, complications and notifications are undersold by the simulator and need device
  dogfood before release; say so in the handoff instead of implying they were verified.
- **Set the run destination after every scheme switch.** `XcodeSwitchScheme` can quietly move the
  destination (to "My Mac (Designed for iPad)" for an iOS scheme), and a test run there uses stale
  products and can report a fixed test as failing. Read the destination it returns.
- **Verify the build, do not trust the timing.** A second scheme that builds in seconds is equally
  consistent with a warm cache and with a no-op. Read the build log for the target platform and a
  real compile count before claiming a platform built.
- **Never `cd` into a repo folder in a shell; use absolute paths.** Claude Code drops a
  `.claude/.cc-writes/` scratch directory wherever the shell sits, and Xcode's "Convert to Folder"
  refuses any folder holding files the project does not reference.
- **Render previews one at a time.** Parallel `RenderPreview` calls came back with the wrong
  `displayName` (only `sourceLineNumber` matched the request) and left DerivedData missing build task
  contexts, so later builds failed with "failed to deserialize Info.plist task context" until the
  affected scheme (or the other run destination) built again. A re-render inside an existing preview
  session can also crash in `swift_release` as a finished `.task`'s closure is torn down, or keep
  showing the loading placeholder, while the app itself runs clean; close and reopen the workspace
  for a fresh session before suspecting the code. A widget preview's `timelineIndex` didn't select
  its entry either: to look at one moment, add a throwaway `#Preview` with that single entry.
- **Pick the preview's device instead of moving the run destination.** Since Xcode 27.2,
  `RenderPreview` returns `supportedOverrides.renderDestinations` and takes
  `preferredRenderDestination` (any of `identifier`, `deviceModelName`, `platformName`,
  `systemVersion`), so one call renders on an iPad, an iPhone Duo or an older OS without
  `XcodeSwitchRunDestination`. A destination that matches nothing silently falls back to the
  automatic one and says so in `errors`, so read `errors` before trusting the snapshot. The first
  render on a simulator that isn't booted can outlast the default 120 s timeout; pass `timeout: 300`
  rather than retrying blind. The destinations include older-OS simulators, so a preview is also the
  quickest look at a screen on the deployment floor.
- **Launch on the oldest supported OS before a release.** A framework older than the deployment
  floor links strongly, and Swift can still import a newer symbol from it strongly even inside an
  `#available` block (an iOS 18 enum case used behind `#available(iOS 26, *)`, with an iOS 17 floor),
  so the app dies in dyld at launch on the older OS while every build and test stays green. dyld binds
  every strong symbol at load, so one clean launch on a floor-OS simulator proves the imports; the fix
  is `-weak_framework <Name>` in that target's `OTHER_LDFLAGS`, then `nm -m` shows the symbol as
  `weak external`. The device-interaction tools only offer simulators on the current OS family (on
  Xcode 27.2, iOS 27 and later), so launch an older one with `RunProject` on that destination and take
  the screenshot with `xcrun simctl io <udid> screenshot <path>`.
- **`RunProject` can rewrite a shared scheme.** Run without the debugger, it saved the scheme's Run
  action with LLDB switched off (`selectedDebuggerIdentifier = ""`, the PosixSpawn launcher) plus a
  Profile `MacroExpansion`. Check `git status` on `xcshareddata/xcschemes/` after a run and put back
  what the run changed before anything is committed.
- **Copy preview snapshots by name prefix.** `RenderPreview` names its PNGs with the time, and macOS
  puts a narrow no-break space (U+202F) before AM/PM, so a typed path never matches. List the folder
  and match the start of the name (`next(n for n in os.listdir(dir) if n.startswith(prefix))`), and
  copy each snapshot as soon as it renders.
- **Test an iPhone Duo's inner display through a preview.** The device-interaction tools have no
  fold command and the Duo simulator boots on its closed outer display (466×678 pt), so a run never
  reaches regular width there. Render on the Duo with the `Display` variant (`Outer`, `Inner`)
  alongside `Orientation`, `{"Display": "Inner"}` for the open display and its size classes. The Duo
  has a simulator runtime of its own (on Xcode 27.2, a separate `iOS 27.2` runtime only the Duo uses),
  so check it in `xcrun simctl list runtimes` rather than assuming the iPhones' runtime covers it. A
  preview shows one screen without the app's sidebar, so check the running app too: unfold the
  simulator in Device Hub, run it, and screenshot the inner display, which `DeviceInteractionSynthesize`
  can't see (it captures the dark outer one). `xcrun simctl io <udid> enumerate` lists it as `LCD-1`;
  pass its Unique ID to `xcrun simctl io <udid> screenshot --display=<id> <path>`, as a bare command of
  its own.

## After an Xcode update

- Bump `.xcode-version` only as its own reviewed change, then build every scheme in each
  configuration and run every test plan on the new toolchain before anything else lands.
- If the headless service reports simulators as a mismatched platform, reconnect the MCP client
  (`/mcp`) and restart the service (`sudo xcrun mcp-server stop`) before suspecting the project.
- A build that finishes in seconds after the update may be the operator's GUI build sitting in the
  shared DerivedData, which compiles nothing and so reports none of the new compiler's warnings. For
  the warning census, build once into a scratch `-derivedDataPath` with `xcodebuild` (an excluded
  command) in the background.
- An SDK update can change locale data under a test: the riyal sign moved to U+20C1 on macOS 27.2.
  Print the new value's Unicode scalars (`RunCodeSnippet`) before rewriting the one assertion.
- Before deleting an older simulator runtime, read `xcrun simctl list runtimes --json` and check
  the new runtime's `supportedDeviceTypes` cover every device on the old one. A point release can
  split runtimes by device, and devices on a deleted runtime go with it. `xcrun simctl runtime
  delete` only sees runtimes stored as disk images (`xcrun simctl runtime list`); one installed as a
  macOS-managed asset (under `/System/Library/AssetsV2/com_apple_MobileAsset_*SimulatorRuntime/`)
  answers "No runtime disk images or bundles found" and is removed from Xcode Settings → Components,
  by the operator. Try `--dry-run` first.
- Old runtimes for the deployment floor (watchOS 10 on Xcode 27.2) aren't offered by
  `xcodebuild -downloadPlatform`; the operator adds them from Xcode Settings → Components.
- Apple's skills live in a folder per Xcode build, so a new build needs its own export (below).

## Apple's skills

Xcode ships agent skills written by Apple's framework teams. They state that they supersede
general training on their topics. Read them as files, not as a plugin: the plugin Xcode exports
(`xcode-integration`) registers a second `xcode` server beside the home's, and
`xcrun mcpbridge run-agent` launches Xcode's own copy of the agent with its own config, outside
this home.

- **Where:** `~/Library/Developer/Xcode/CodingAssistant/ExportedPlugins/<build>/claude/skills/<skill>/SKILL.md`,
  with `<build>` from the second line of `xcodebuild -version` (`Build version 27B52` → `27B52`).
  Read the `SKILL.md`, then only the `references/` files it points to for the task in hand. List the
  folder rather than trusting the names below: the what's-new skills are renamed every year.
- **A missing folder** means this Xcode build hasn't exported its skills yet. The operator runs
  `xcrun agent plugin path --plugin-format claude` once per build; it needs a running Xcode, so it
  can't run from the sandbox.
- **A tool description that says to activate `xcode-integration:<skill>`** (the String Catalog
  tools do) means: read that skill's file before the call.
- When the repo's manual lists its own skills for the same area, read both: Apple's for API
  correctness and what's new, the repo's for its conventions.

| Before… | Read |
|---|---|
| SwiftUI code, layout, animation, performance | `swiftui-specialist`, `swiftui-whats-new-<year>` |
| App Intents, Siri, Shortcuts | `app-intents-specialist`, `app-intents-whats-new-<year>` |
| iPad, multiple windows, Stage Manager, the iPhone Duo | `app-resizability` |
| Adding a language or translating String Catalogs | `translation-coordinator` (it hands strings to `translation`) |
| Checking UI on a simulator or device | `device-interaction` (gesture syntax incl. the Digital Crown, hitPoints, a subagent per session; `DeviceInteractionStartWorkspaceSession` names it in `skillToTrigger`) |
| Slow screens, hangs, memory or energy | `xctrace` |
| Migrating or modernizing tests | `modernize-tests` |
| Accessibility before a release | `accessibility-voiceover-specialist`, `accessibility-dynamic-type-specialist`, `accessibility-sufficient-contrast-specialist` |
| Hardening build settings | `audit-xcode-security-settings` |
| C or Objective-C buffer safety | `adopt-c-bounds-safety` |
| A document-based app | `building-document-based-swiftui-applications` |
