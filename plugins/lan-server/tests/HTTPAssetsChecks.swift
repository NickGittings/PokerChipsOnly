import Foundation

@main struct HTTPAssetsChecks {
    static func main() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let root = base.appendingPathComponent("public")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("assets"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        try Data("spa".utf8).write(to: root.appendingPathComponent("index.html"))
        try Data("js".utf8).write(to: root.appendingPathComponent("assets/app.js"))
        try Data("secret".utf8).write(to: base.appendingPathComponent("secret"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: base.appendingPathComponent("secret"))
        let assets = HTTPAssets(root: root)
        for route in ["/", "/board", "/setup"] { precondition(assets.file(for: route)?.lastPathComponent == "index.html", route) }
        precondition(assets.file(for: "/assets/app.js")?.lastPathComponent == "app.js")
        for path in ["/../secret", "/assets/../../secret", "/assets/./app.js", "/escape", "/.git/config", "/assets/missing.js", "/api/health", "/ws", "/unknown", "relative", "/assets\\app.js", "/\0"] {
            precondition(assets.file(for: path) == nil, path)
        }
        precondition(assets.file(for: "/%2e%2e/secret") == nil)
        precondition(HTTPAssets.mime(root.appendingPathComponent("APP.JS")) == "text/javascript; charset=utf-8")
        try FileManager.default.removeItem(at: root.appendingPathComponent("index.html"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("index.html"), withDestinationURL: base.appendingPathComponent("secret"))
        precondition(assets.file(for: "/board") == nil)
        print("HTTP asset checks passed (SPA routes, traversal, symlink confinement, missing assets, MIME)")
    }
}
