import Foundation
import Telegraph

/// Server-side frames stay as bytes until the final text fragment, including split UTF-8 scalars.
struct TextWebSocketDecoder {
    let maxMessageBytes: Int
    private var bytes: [UInt8] = []
    private var text: Data?

    init(maxMessageBytes: Int = 10_485_760) { self.maxMessageBytes = maxMessageBytes }

    mutating func append(_ data: Data, emit: (WebSocketMessage) -> Void) throws {
        bytes.append(contentsOf: data)
        var offset = 0
        defer { bytes.removeFirst(offset) }
        while bytes.count - offset >= 2 {
            let first = bytes[offset], second = bytes[offset + 1]
            let final = first & 0x80 != 0, control = first & 0x08 != 0
            guard first & 0x70 == 0, second & 0x80 != 0,
                  let opcode = WebSocketOpcode(rawValue: first & 0x0f) else { throw WebSocketError.invalidMessage }
            let sizeTag = second & 0x7f
            let extended = sizeTag == 126 ? 2 : sizeTag == 127 ? 8 : 0
            guard bytes.count - offset >= 2 + extended else { return }
            var length = UInt64(sizeTag)
            if extended > 0 {
                length = 0
                for byte in bytes[(offset + 2)..<(offset + 2 + extended)] { length = (length << 8) | UInt64(byte) }
                guard (extended == 2 && length >= 126) || (extended == 8 && length > 65535 && length >> 63 == 0) else { throw WebSocketError.invalidPayloadLength }
            }
            guard !control || (final && length <= 125) else { throw WebSocketError.invalidMessage }
            guard length <= UInt64(maxMessageBytes) else { throw WebSocketError.payloadTooLarge }
            let header = 2 + extended + 4, count = Int(length)
            guard bytes.count - offset >= header + count else { return }
            let mask = Array(bytes[(offset + 2 + extended)..<(offset + header)])
            var payload = Data(bytes[(offset + header)..<(offset + header + count)])
            payload.mask(with: mask)
            offset += header + count
            switch opcode {
            case .textFrame:
                guard text == nil else { throw WebSocketError.invalidMessage }
                if final { try emitText(payload, emit: emit) } else { text = payload }
            case .continuationFrame:
                guard let size = text?.count else { throw WebSocketError.invalidMessage }
                guard count <= maxMessageBytes - size else { throw WebSocketError.payloadTooLarge }
                text?.append(payload)
                if final { let complete = text!; text = nil; try emitText(complete, emit: emit) }
            case .binaryFrame:
                throw TextWebSocketError.binaryUnsupported
            case .ping, .pong:
                emit(WebSocketMessage(opcode: opcode, payload: .binary(payload)))
            case .connectionClose:
                guard count != 1 else { throw WebSocketError.invalidMessage }
                text = nil
                if count == 0 { emit(WebSocketMessage(opcode: .connectionClose)); return }
                let code = UInt16(payload[0]) << 8 | UInt16(payload[1])
                guard (1000...1014).contains(code) && ![1004, 1005, 1006].contains(code) || (3000...4999).contains(code) else { throw WebSocketError.invalidMessage }
                guard let reason = String(data: payload.dropFirst(2), encoding: .utf8) else { throw WebSocketError.payloadIsNotText }
                emit(WebSocketMessage(closeCode: code, reason: reason))
                return
            }
        }
    }

    private func emitText(_ data: Data, emit: (WebSocketMessage) -> Void) throws {
        guard let value = String(data: data, encoding: .utf8) else { throw WebSocketError.payloadIsNotText }
        emit(WebSocketMessage(text: value))
    }
}

enum TextWebSocketError: Error { case binaryUnsupported }
