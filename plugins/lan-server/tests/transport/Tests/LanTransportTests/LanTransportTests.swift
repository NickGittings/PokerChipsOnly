import XCTest
@testable import LanCore

final class LanTransportTests: XCTestCase {
    @MainActor func testHTTPWebSocketAndLifecycle() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("assets"), withIntermediateDirectories: true)
        try Data("<html>transport fixture</html>".utf8).write(to: root.appendingPathComponent("index.html"))
        try Data("console.log('fixture')".utf8).write(to: root.appendingPathComponent("assets/app.js"))
        defer { try? FileManager.default.removeItem(at: root) }
        let transport = LanTransport()
        let opened = expectation(description: "connection event")
        let received = expectation(description: "message event")
        let closed = expectation(description: "close event")
        var events: [String] = []
        var connection: String?
        transport.event = { event, values in
            guard event != "error" else { return } // mDNS publication can be unavailable in a test runner.
            events.append(event)
            if event == "connection" { connection = values["id"] as? String; opened.fulfill() }
            if event == "message" {
                XCTAssertEqual(values["id"] as? String, connection)
                XCTAssertEqual(values["data"] as? String, "hello")
                try! transport.send(id: connection!, data: values["data"] as! String)
                received.fulfill()
            }
            if event == "close" { XCTAssertEqual(values["id"] as? String, connection); closed.fulfill() }
        }
        _ = try transport.start(port: 0, name: "Poker transport test", assets: root)
        defer { transport.stop() }
        let origin = "http://127.0.0.1:\(transport.port)"
        XCTAssertGreaterThan(transport.port, 0)
        XCTAssertThrowsError(try transport.start(port: 0, name: "duplicate", assets: root))
        for path in ["/", "/board", "/setup"] {
            let (data, response) = try await URLSession.shared.data(from: URL(string: origin + path)!)
            XCTAssertEqual((response as! HTTPURLResponse).statusCode, 200)
            XCTAssertEqual(String(decoding: data, as: UTF8.self), "<html>transport fixture</html>")
        }
        for path in ["/missing.js", "/api/health", "/%2e%2e/secret", "/.git/config"] {
            let (_, response) = try await URLSession.shared.data(from: URL(string: origin + path)!)
            XCTAssertEqual((response as! HTTPURLResponse).statusCode, 404, path)
        }
        var head = URLRequest(url: URL(string: origin + "/assets/app.js")!); head.httpMethod = "HEAD"
        let (headData, headResponse) = try await URLSession.shared.data(for: head)
        XCTAssertEqual((headResponse as! HTTPURLResponse).statusCode, 200); XCTAssertTrue(headData.isEmpty)
        let socket = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(transport.port)/ws")!)
        socket.resume()
        await fulfillment(of: [opened], timeout: 3)
        try await socket.send(.string("hello"))
        let echo = try await socket.receive()
        if case .string(let text) = echo { XCTAssertEqual(text, "hello") } else { XCTFail("Expected text echo") }
        await fulfillment(of: [received], timeout: 3)
        let wrongPath = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(transport.port)/other")!)
        wrongPath.resume()
        do { _ = try await wrongPath.receive(); XCTFail("Upgrade on /other must fail") } catch { }
        wrongPath.cancel(with: .normalClosure, reason: nil)
        transport.stop()
        await fulfillment(of: [closed], timeout: 3)
        XCTAssertEqual(events, ["connection", "message", "close"])
        XCTAssertThrowsError(try transport.send(id: connection!, data: "after stop"))
        transport.stop() // idempotent, no duplicate close
        XCTAssertEqual(events.count, 3)
        _ = try transport.start(port: 0, name: "restart", assets: root)
        XCTAssertGreaterThan(transport.port, 0)
    }

    @MainActor func testBrowseBoundsAndCancel() async throws {
        let browse = BonjourBrowse()
        let canceled = expectation(description: "canceled scan")
        try browse.start(timeout: 3) { result in
            if case .success = result { XCTFail("Cancel should reject") }
            canceled.fulfill()
        }
        XCTAssertThrowsError(try browse.start(timeout: 3) { _ in })
        browse.cancel()
        await fulfillment(of: [canceled], timeout: 1)
        let bounded = expectation(description: "bounded scan")
        try browse.start(timeout: 1) { _ in bounded.fulfill() }
        await fulfillment(of: [bounded], timeout: 2)
    }
}
