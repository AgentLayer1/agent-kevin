---
paths:
  - "**/*.pbxproj"
  - "**/*.xcconfig"
  - "**/*.entitlements"
  - "**/Info.plist"
  - "**/*.xctestplan"
  - "**/Package.swift"
  - "**/Package.resolved"
---

# Xcode Project Surgery

The project file is the most error-prone thing an agent touches. Prefer a tool call over a text
edit everywhere below.

## project.pbxproj

- **Never hand-edit a pbxproj.** A project full of explicit file references turns "add a file" into
  surgery on a several-hundred-KB file; one real app measured 544 explicit refs against 3
  synchronized groups.
- **Synchronized folders (Xcode 16+) make file adds zero-touch**: drop the file in the folder and it
  is in the target. Prefer converting a group to a folder (operator work in Xcode, cheapest on
  single-target folders first) over teaching an agent to edit refs.
- **New targets come from a template**, via `XcodeNewTarget`, not a pbxproj edit.
- **A hosted test target needs an explicit target dependency on the app** (Build Phases →
  Dependencies). `XcodeNewTarget` does not add it, and without it Xcode's dependency scan reports
  "missing a dependency on ..." for every module the app links.
- A test file that is not wired into the project **silently runs zero tests**. Confirm the count.

## Build settings

- **Settings live in `*.xcconfig`, never inside the pbxproj.** Use `UpdateTargetBuildSetting` /
  `GetTargetBuildSettings` to inspect and change them, and `AddEntitlement` / `AddInfoPlist` for
  those files.
- Single-source the version in one xcconfig (`MARKETING_VERSION` + `CURRENT_PROJECT_VERSION`). A
  release bump edits both lines, always: the build number must increase monotonically.

## SPM dependencies

- **`Package.resolved` is the only thing making a branch-tracked dependency reproducible.** Never
  refresh package resolution as a side effect of something else; build with the committed file
  (`-disableAutomaticPackageResolution`) and resolve deliberately, in its own commit.
- **With a remote branch dependency, editing the local package checkout changes nothing** in the
  consuming build until re-resolution. An easy hour to lose.
- **A local package inside a `.xcworkspace` overrides the remote dependency of the same identity.**
  That is what lets app and package change together without branch switching, while a clean checkout
  or CI still resolves from the remote. Opening such a workspace also rewrites the *package's* own
  `Package.resolved` with the app's graph: that drift is never committed, restore it with
  `git checkout -- Package.resolved`.
- **Release order**: push the packages first, re-resolve so `Package.resolved` pins the new
  revisions (its own commit), then archive. An archive whose local packages have unpushed commits
  ships code no consumer can reproduce.
