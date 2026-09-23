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
- **Two shell exceptions**, and only when the home's settings carry the matching
  `sandbox.excludedCommands` entry: `simctl` for simulator state the MCP has no action for
  (location, erase, device list), and `xcodebuild archive` / `-exportArchive`, because the MCP
  surface has no archive action. Anything that uploads (`-exportArchive`, `altool`, `notarytool`)
  is gated on the operator by a `permissions.ask` rule. Never widen the sandbox yourself.

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
- **Verify the build, do not trust the timing.** A second scheme that builds in seconds is equally
  consistent with a warm cache and with a no-op. Read the build log for the target platform and a
  real compile count before claiming a platform built.
- **Never `cd` into a repo folder in a shell; use absolute paths.** Claude Code drops a
  `.claude/.cc-writes/` scratch directory wherever the shell sits, and Xcode's "Convert to Folder"
  refuses any folder holding files the project does not reference.
