import Foundation
import Telegraph

/// Keep Telegraph's HTTP listener/handshake/writer; replace its frame-level text decoder.
final class TextWebSocketServer: Server, TextWebSocketConnectionDelegate {
    private let socketQueue = DispatchQueue(label: "PokerChips.LanServer.websockets")
    private let lock = NSLock()
    private var connections: [ObjectIdentifier: TextWebSocketConnection] = [:]

    override func handleUpgrade(request: HTTPRequest, connection: HTTPConnection) {
        guard request.isWebSocketUpgrade, request.uri.path == "/ws" else { connection.close(immediately: true); return }
        // Remove the upgraded HTTP wrapper from Telegraph's HTTP connection set.
        self.connection(connection, didCloseWithError: nil)
        let (socket, data) = connection.upgrade()
        let webSocket = TextWebSocketConnection(socket: socket, config: webSocketConfig, queue: socketQueue)
        webSocket.delegate = self
        lock.lock(); connections[ObjectIdentifier(webSocket)] = webSocket; lock.unlock()
        delegateQueue.async { [weak self] in
            guard let self else { return }
            self.webSocketDelegate?.server(self, webSocketDidConnect: webSocket, handshake: request)
        }
        webSocket.open(data: data)
    }

    override func stop(immediately: Bool = false) {
        super.stop(immediately: immediately)
        lock.lock(); let active = Array(connections.values); lock.unlock()
        for socket in active { socket.close(immediately: immediately) }
    }

    fileprivate func received(_ socket: TextWebSocketConnection, message: WebSocketMessage) {
        delegateQueue.async { [weak self] in
            guard let self else { return }
            self.webSocketDelegate?.server(self, webSocket: socket, didReceiveMessage: message)
        }
    }
    fileprivate func closed(_ socket: TextWebSocketConnection, error: Error?) {
        lock.lock(); connections.removeValue(forKey: ObjectIdentifier(socket)); lock.unlock()
        delegateQueue.async { [weak self] in
            guard let self else { return }
            self.webSocketDelegate?.server(self, webSocketDidDisconnect: socket, error: error)
        }
    }
}

private protocol TextWebSocketConnectionDelegate: AnyObject {
    func received(_ socket: TextWebSocketConnection, message: WebSocketMessage)
    func closed(_ socket: TextWebSocketConnection, error: Error?)
}

private final class TextWebSocketConnection: WebSocket, TCPSocketDelegate {
    weak var delegate: TextWebSocketConnectionDelegate?
    private let socket: TCPSocket
    private let config: WebSocketConfig
    private let queue: DispatchQueue
    private var decoder = TextWebSocketDecoder()
    private var pingTimer: DispatchSourceTimer?
    private var closing = false, closed = false
    var localEndpoint: Endpoint? { socket.localEndpoint }
    var remoteEndpoint: Endpoint? { socket.remoteEndpoint }

    init(socket: TCPSocket, config: WebSocketConfig, queue: DispatchQueue) {
        self.socket = socket; self.config = config; self.queue = queue
    }
    func open(data: Data?) {
        queue.async {
            self.socket.setDelegate(self, queue: self.queue)
            if self.config.pingInterval > 0 {
                let timer = DispatchSource.makeTimerSource(queue: self.queue)
                timer.schedule(deadline: .now() + self.config.pingInterval, repeating: self.config.pingInterval)
                timer.setEventHandler { [weak self] in
                    guard let self, !self.closing && !self.closed else { return }
                    self.write(WebSocketMessage(opcode: .ping))
                }
                self.pingTimer = timer; timer.resume()
            }
            if let data, !data.isEmpty { self.receive(data) }
            else { self.socket.read(timeout: self.config.readTimeout) }
        }
    }
    func send(message: WebSocketMessage) { queue.async { if !self.closing && !self.closed { self.write(message) } } }
    func close(immediately: Bool) {
        queue.async {
            guard !self.closed else { return }
            if immediately { self.closing = true; self.pingTimer?.cancel(); self.pingTimer = nil; self.socket.close(when: .immediately) }
            else { self.finish(WebSocketMessage(closeCode: 1001)) }
        }
    }
    private func write(_ message: WebSocketMessage) {
        message.maskBit = config.maskMessages
        message.write(to: socket, headerTimeout: config.writeHeaderTimeout, payloadTimeout: config.writePayloadTimeout)
    }
    private func finish(_ message: WebSocketMessage) {
        guard !closing else { return }
        closing = true
        pingTimer?.cancel(); pingTimer = nil
        write(message)
        socket.close(when: .afterWriting)
    }
    private func receive(_ data: Data) {
        guard !closing && !closed else { return }
        do {
            try decoder.append(data) { message in
                switch message.opcode {
                case .ping: self.write(WebSocketMessage(opcode: .pong, payload: message.payload))
                case .pong: break
                case .connectionClose: self.finish(message)
                default: self.delegate?.received(self, message: message)
                }
            }
            if !closing { socket.read(timeout: config.readTimeout) }
        } catch let error as WebSocketError { finish(WebSocketMessage(error: error)) }
        catch { finish(WebSocketMessage(closeCode: 1003, reason: "Text messages only")) }
    }
    func socketDidOpen(_ socket: TCPSocket) {}
    func socketDidWrite(_ socket: TCPSocket, tag: Int) {}
    func socketDidRead(_ socket: TCPSocket, data: Data, tag: Int) { receive(data) }
    func socketDidClose(_ socket: TCPSocket, error: Error?) {
        guard !closed else { return }
        closed = true; pingTimer?.cancel(); pingTimer = nil; decoder = TextWebSocketDecoder()
        delegate?.closed(self, error: error)
    }
}
