import XCTest
import Telegraph
@testable import LanCore

private final class FrameStream: WriteStream {
    var data = Data()
    func write(data: Data, timeout: TimeInterval) { self.data.append(data) }
    func flush() {}
}

private func frame(_ opcode: WebSocketOpcode, _ bytes: Data = Data(), final: Bool = true) -> WebSocketMessage {
    let message = WebSocketMessage(opcode: opcode, payload: .binary(bytes))
    message.finBit = final
    return message
}
private func encoded(_ messages: [WebSocketMessage]) -> Data {
    let stream = FrameStream()
    for message in messages { message.write(to: stream, headerTimeout: 1, payloadTimeout: 1) }
    return stream.data
}

private final class FragmentClient: WebSocketClientDelegate {
    let frames: [WebSocketMessage]
    let echo: (WebSocketClient, String) -> Void
    init(frames: [WebSocketMessage], echo: @escaping (WebSocketClient, String) -> Void) { self.frames = frames; self.echo = echo }
    func webSocketClient(_ client: WebSocketClient, didConnectToHost host: String) { for frame in frames { client.send(message: frame) } }
    func webSocketClient(_ client: WebSocketClient, didDisconnectWithError error: Error?) {}
    func webSocketClient(_ client: WebSocketClient, didReceiveData data: Data) {}
    func webSocketClient(_ client: WebSocketClient, didReceiveText text: String) { DispatchQueue.main.async { self.echo(client, text) } }
}

final class WebSocketFragmentTests: XCTestCase {
    @MainActor func testFragmentedJSONAndFollowingMessageEcho() async throws {
        let value = "{\"type\":\"hello\"}"
        try await assertEcho(value, pieces: [Data("{\"type\":".utf8), Data("\"hello\"}".utf8)])
    }
    @MainActor func testSplitUTF8WithInterleavedPingEcho() async throws {
        let value = "{\"player\":\"A😀é\",\"type\":\"hello\"}"
        let data = Data(value.utf8), split = Array(data).firstIndex(of: 0xf0)!
        try await assertEcho(value, pieces: [data.subdata(in: 0..<(split + 1)), data.subdata(in: (split + 1)..<(split + 3)), data.subdata(in: (split + 3)..<data.count)])
    }

    @MainActor private func assertEcho(_ value: String, pieces: [Data]) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("fixture".utf8).write(to: root.appendingPathComponent("index.html"))
        defer { try? FileManager.default.removeItem(at: root) }
        let transport = LanTransport()
        defer { transport.stop() }
        let closed = expectation(description: "client closes after both complete echoes")
        var messages: [String] = [], echoes: [String] = [], events: [String] = []
        var connection: String?
        transport.event = { event, data in
            guard event != "error" else { return }
            events.append(event)
            if event == "connection" { connection = data["id"] as? String }
            if event == "message" {
                XCTAssertEqual(data["id"] as? String, connection)
                let text = data["data"] as! String
                messages.append(text)
                do { try transport.send(id: connection!, data: text) } catch { XCTFail("Echo failed: \(error)") }
            }
            if event == "close" { closed.fulfill() }
        }
        _ = try transport.start(port: 0, name: "Fragment regression", assets: root)
        var frames = [frame(.textFrame, pieces[0], final: false), frame(.ping, Data("keepalive".utf8))]
        for index in 1..<pieces.count { frames.append(frame(.continuationFrame, pieces[index], final: index == pieces.count - 1)) }
        frames.append(WebSocketMessage(text: "next"))
        let client = try WebSocketClient(url: URL(string: "ws://127.0.0.1:\(transport.port)/ws")!)
        defer { client.close(immediately: true) }
        let delegate = FragmentClient(frames: frames) { client, text in
            echoes.append(text)
            if echoes.count == 2 { client.close(immediately: true) }
        }
        client.delegate = delegate; client.connect()
        await fulfillment(of: [closed], timeout: 5)
        withExtendedLifetime(delegate) {}
        XCTAssertEqual(messages, [value, "next"])
        XCTAssertEqual(echoes, [value, "next"])
        XCTAssertEqual(events, ["connection", "message", "message", "close"])
    }

    func testDecoderWaitsForFinalFrameAcrossTCPChunksAndPings() throws {
        var decoder = TextWebSocketDecoder()
        var messages: [WebSocketMessage] = []
        let first = encoded([frame(.textFrame, Data("{\"a\":".utf8), final: false)])
        for byte in first { try decoder.append(Data([byte])) { messages.append($0) } }
        XCTAssertTrue(messages.isEmpty)
        let tail = encoded([frame(.ping, Data([1, 2])), frame(.continuationFrame, Data("1}".utf8)), WebSocketMessage(text: "next")])
        for byte in tail { try decoder.append(Data([byte])) { messages.append($0) } }
        XCTAssertEqual(messages.count, 3)
        XCTAssertEqual(messages[0].opcode, .ping)
        if case .text(let text) = messages[1].payload { XCTAssertEqual(text, "{\"a\":1}") } else { XCTFail("Expected assembled text") }
        if case .text(let text) = messages[2].payload { XCTAssertEqual(text, "next") } else { XCTFail("Expected following text") }
    }

    func testDecoderRejectsInvalidFragmentSequencesUTF8AndOversizeMessages() throws {
        let invalid = [
            encoded([frame(.continuationFrame, Data([65]))]),
            encoded([frame(.textFrame, Data([65]), final: false), frame(.textFrame, Data([66]))]),
            encoded([frame(.textFrame, Data([0xf0]), final: false), frame(.continuationFrame, Data([65]))]),
            encoded([frame(.ping, final: false)]),
            encoded([frame(.binaryFrame, Data([1]))]),
            Data([0x81, 1, 65]), // Client frames must be masked.
            Data([0xc1, 0x80, 0, 0, 0, 0]), // No extensions were negotiated.
            encoded([frame(.textFrame, Data([65, 66, 67]), final: false), frame(.continuationFrame, Data([68, 69]))])
        ]
        for data in invalid {
            var decoder = TextWebSocketDecoder(maxMessageBytes: 4)
            XCTAssertThrowsError(try decoder.append(data) { _ in })
        }
    }

    func testExtendedFrameLengthsAndSplitHeaders() throws {
        for count in [126, 65_536] {
            let value = String(repeating: "x", count: count)
            let data = encoded([WebSocketMessage(text: value)])
            var decoder = TextWebSocketDecoder(), values: [String] = []
            for byte in data.prefix(14) { try decoder.append(Data([byte])) { _ in XCTFail("An incomplete payload was emitted") } }
            try decoder.append(data.dropFirst(14)) { if case .text(let text) = $0.payload { values.append(text) } }
            XCTAssertEqual(values, [value])
        }
        for data in [Data([0x81, 0xfe, 0, 1]), Data([0x81, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0])] {
            var decoder = TextWebSocketDecoder()
            XCTAssertThrowsError(try decoder.append(data) { _ in })
        }
    }

    func testDecoderBuffersAreIndependentAndCloseDiscardsPartialText() throws {
        var first = TextWebSocketDecoder(), second = TextWebSocketDecoder()
        var firstText: [String] = [], secondText: [String] = []
        try first.append(encoded([frame(.textFrame, Data("fi".utf8), final: false)])) { _ in XCTFail("Partial text escaped") }
        try second.append(encoded([frame(.textFrame, Data("se".utf8), final: false), frame(.continuationFrame, Data("cond".utf8))])) {
            if case .text(let value) = $0.payload { secondText.append(value) }
        }
        try first.append(encoded([frame(.continuationFrame, Data("rst".utf8))])) {
            if case .text(let value) = $0.payload { firstText.append(value) }
        }
        XCTAssertEqual(firstText, ["first"]); XCTAssertEqual(secondText, ["second"])
        try first.append(encoded([frame(.textFrame, Data([65]), final: false), WebSocketMessage(closeCode: 1000)])) { XCTAssertEqual($0.opcode, .connectionClose) }
    }
}
