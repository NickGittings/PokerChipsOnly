# 0003 — Swift Package Manager, and the official barcode scanner

**Status:** Accepted (2026-09-25)

## Context

`docs/native-app-plan.md` Stage 1 assumed CocoaPods (`brew install cocoapods`) and `@capacitor-mlkit/barcode-scanning` for the join-QR scan. Capacitor 8 (`@capacitor/cli` 8.5) scaffolds iOS with **Swift Package Manager** by default, and `npx cap add ios` reported that `@capacitor-mlkit/barcode-scanning` "does not have a Package.swift" — it ships only a podspec, so SPM silently skips it and the scan button would fail at runtime.

Options considered: (1) install CocoaPods and build the iOS project with Pods; (2) swap to a scanner that supports SPM; (3) decode QR in JS via `getUserMedia`.

## Decision

**SPM + `@capacitor/barcode-scanner`** (the official Ionic plugin, v3.x, peer `@capacitor/core >=8`), which ships both a `Package.swift` and a podspec. After the swap `cap sync` reports all six plugins have a `Package.swift`, and `xcodebuild` for the iOS Simulator succeeds with no CocoaPods on the machine.

The scanner is loaded with a dynamic `import()` in `src/views/PairView.tsx` so its `html5-qrcode` dependency stays out of the main web bundle.

## Consequences

- No CocoaPods install and no `Pods/` in the repo; the CocoaPods trunk is on its way to read-only, so this also avoids building on a deprecated path.
- Same job, same UX as the plan: scan the board's existing `joinUrl` QR, zero server changes. Needs `NSCameraUsageDescription` (added).
- Any future plugin must ship a `Package.swift` — check with `npx cap sync ios` (it warns) before adopting one.
- The scanner's behavior on cancel is handled defensively (empty result or rejection both leave the pairing screen as-is). Camera scanning can't be exercised in the Simulator; verify on a real device.

## Rejected alternatives

- **CocoaPods + ML Kit** — works, but adds a machine dependency and a deprecated toolchain for one plugin.
- **JS QR decode via `getUserMedia`** — no native dependency and would work on web too, but it's a larger deviation from the approved plan and camera permission/UX inside WKWebView is less predictable than a native scanner.
