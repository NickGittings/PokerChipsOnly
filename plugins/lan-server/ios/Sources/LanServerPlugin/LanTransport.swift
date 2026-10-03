import Foundation
import Telegraph

/// Access on main queue only; Telegraph delegates use that same queue.
final class LanTransport: NSObject, ServerWebSocketDelegate, ServerDelegate, NetServiceDelegate {
    static let serviceType = "_pokerchips._tcp."
    var event: ((String, [String: Any]) -> Void)?
    private var server: Server?
    private var service: NetService?
    private var sockets: [String: WebSocket] = [:]
    private var ids: [ObjectIdentifier: String] = [:]
    var port: Int { server?.port ?? 0 }

    func start(port: UInt16, name: String, assets: URL) throws -> [String] {
        guard server == nil else { throw failure("LanServer is already running; stop before starting again") }
        let files = HTTPAssets(root: assets)
        guard files.file(for: "/") != nil else { throw failure("Bundled public/index.html is missing; run build and cap sync ios") }
        let candidate = Server()
        candidate.delegateQueue = .main
        candidate.delegate = self
        candidate.webSocketDelegate = self
        // Telegraph's default WS handler accepts every path; replace it with a /ws gate.
        candidate.httpConfig.requestHandlers = [WebSocketRoute(), AssetHandler(files: files)]
        try candidate.start(port: Int(port))
        server = candidate
        let published = NetService(domain: "local.", type: Self.serviceType, name: name, port: Int32(candidate.port))
        published.delegate = self
        published.setTXTRecord(NetService.data(fromTXTRecord: ["path": Data("/ws".utf8), "version": Data("1".utf8)]))
        published.publish()
        service = published
        return LANAddresses.urls(port: UInt16(candidate.port))
    }

    func stop() {
        service?.stop(); service?.delegate = nil; service = nil
        let previous = server; server = nil
        previous?.stop(immediately: true)
        let closed = sockets.keys.sorted()
        sockets.removeAll(); ids.removeAll()
        for id in closed { event?("close", ["id": id]) }
    }

    func send(id: String, data: String) throws {
        guard let socket = sockets[id] else { throw failure("Connection is closed or unknown") }
        socket.send(text: data)
    }

    func server(_ server: Server, webSocketDidConnect webSocket: WebSocket, handshake: HTTPRequest) {
        guard self.server === server, handshake.uri.path == "/ws" else { webSocket.close(immediately: true); return }
        let id = UUID().uuidString
        sockets[id] = webSocket; ids[ObjectIdentifier(webSocket)] = id
        event?("connection", ["id": id])
    }
    func server(_ server: Server, webSocketDidDisconnect webSocket: WebSocket, error: Error?) {
        guard self.server === server, let id = ids.removeValue(forKey: ObjectIdentifier(webSocket)) else { return }
        sockets.removeValue(forKey: id)
        event?("close", ["id": id])
    }
    func server(_ server: Server, webSocket: WebSocket, didReceiveMessage message: WebSocketMessage) {
        guard self.server === server, let id = ids[ObjectIdentifier(webSocket)] else { return }
        if case .text(let data) = message.payload { event?("message", ["id": id, "data": data]) }
        else if message.opcode == .binaryFrame { webSocket.close(immediately: true) }
    }
    func serverDidStop(_ server: Server, error: Error?) {
        guard self.server === server else { return }
        stop()
        if let error { event?("error", ["operation": "server", "message": error.localizedDescription]) }
    }
    func netService(_ sender: NetService, didNotPublish errorDict: [String: NSNumber]) {
        guard sender === service else { return }
        event?("error", ["operation": "advertise", "message": "Bonjour publication failed: \(errorDict)"])
    }
    private func failure(_ message: String) -> NSError { NSError(domain: "LanServer", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}

private final class WebSocketRoute: HTTPRequestHandler {
    private let upgrade = HTTPWebSocketHandler()
    func respond(to request: HTTPRequest, nextHandler: HTTPRequest.Handler) throws -> HTTPResponse? {
        if request.isWebSocketUpgrade {
            guard request.uri.path == "/ws" else { return HTTPResponse(.notFound) }
            return try upgrade.respond(to: request, nextHandler: nextHandler)
        }
        return try nextHandler(request)
    }
}

private struct AssetHandler: HTTPRequestHandler {
    let files: HTTPAssets
    func respond(to request: HTTPRequest, nextHandler: HTTPRequest.Handler) throws -> HTTPResponse? {
        guard request.method == .GET || request.method == .HEAD else { return HTTPResponse(.methodNotAllowed) }
        guard let file = files.file(for: request.uri.path) else { return HTTPResponse(.notFound) }
        let data = try Data(contentsOf: file, options: .mappedIfSafe)
        // Telegraph implements HEAD suppression at the connection layer.
        return HTTPResponse(.ok, headers: ["Content-Type": HTTPAssets.mime(file), "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"], body: data)
    }
}
