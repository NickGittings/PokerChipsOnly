// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PokerchipsLanServer",
    platforms: [.iOS(.v15)],
    products: [.library(name: "PokerchipsLanServer", targets: ["LanServerPlugin"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/Building42/Telegraph.git", exact: "0.40.0")
    ],
    targets: [.target(name: "LanServerPlugin", dependencies: [
        .product(name: "Capacitor", package: "capacitor-swift-pm"),
        .product(name: "Telegraph", package: "Telegraph")
    ], path: "ios/Sources/LanServerPlugin")]
)
