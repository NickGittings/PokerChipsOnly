// swift-tools-version: 5.9
import PackageDescription

// Test the exact shipping transport on macOS without the iOS-only Capacitor bridge.
let package = Package(name: "LanTransportChecks", platforms: [.macOS(.v12)],
    dependencies: [.package(url: "https://github.com/Building42/Telegraph.git", exact: "0.40.0")],
    targets: [
        .target(name: "LanCore", dependencies: [.product(name: "Telegraph", package: "Telegraph")],
                path: "Sources/LanCore", exclude: ["LanServerPlugin.swift"]),
        .testTarget(name: "LanTransportTests", dependencies: ["LanCore"])
    ])
