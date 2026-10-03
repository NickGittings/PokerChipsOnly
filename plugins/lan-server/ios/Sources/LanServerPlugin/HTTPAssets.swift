import Foundation

/// Paths arrive percent-decoded from Telegraph. Never decode them again.
struct HTTPAssets {
    let root: URL
    init(root: URL) { self.root = root.standardizedFileURL.resolvingSymlinksInPath() }

    func file(for path: String) -> URL? {
        guard path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0") else { return nil }
        let parts = path.split(separator: "/", omittingEmptySubsequences: true)
        guard !parts.contains(where: { $0 == "." || $0 == ".." || $0.hasPrefix(".") }) else { return nil }
        let candidate = root.appendingPathComponent(parts.joined(separator: "/")).standardizedFileURL.resolvingSymlinksInPath()
        guard candidate.path.hasPrefix(root.path + "/") || candidate == root else { return nil }
        if isFile(candidate) { return candidate }
        // Only known client routes receive the SPA document. Missing assets/API paths stay 404.
        guard ["/", "/board", "/setup"].contains(path) else { return nil }
        let index = root.appendingPathComponent("index.html").resolvingSymlinksInPath()
        guard index.path.hasPrefix(root.path + "/"), isFile(index) else { return nil }
        return index
    }

    private func isFile(_ url: URL) -> Bool {
        var directory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &directory) && !directory.boolValue
    }

    static func mime(_ url: URL) -> String {
        ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
         "json": "application/json", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
         "webp": "image/webp", "gif": "image/gif", "ico": "image/x-icon", "woff": "font/woff", "woff2": "font/woff2",
         "mp3": "audio/mpeg", "mp4": "video/mp4"][url.pathExtension.lowercased()] ?? "application/octet-stream"
    }
}
