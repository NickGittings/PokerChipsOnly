import Foundation
import Darwin

enum LANAddresses {
    static func urls(port: UInt16) -> [String] {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0, let first = interfaces else { return [] }
        defer { freeifaddrs(interfaces) }
        var urls = Set<String>()
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let pointer = cursor {
            let interface = pointer.pointee
            cursor = interface.ifa_next
            let name = String(cString: interface.ifa_name)
            guard let address = interface.ifa_addr, name.hasPrefix("en"),
                  interface.ifa_flags & UInt32(IFF_UP) != 0,
                  interface.ifa_flags & UInt32(IFF_LOOPBACK) == 0,
                  address.pointee.sa_family == UInt8(AF_INET) || address.pointee.sa_family == UInt8(AF_INET6) else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let ip = String(cString: host)
            // IPv6 link-local zone identifiers are inconsistently supported by browser URL parsers.
            if ip.contains(":"), !ip.hasPrefix("fe80:"), !ip.contains("%") { urls.insert("http://[\(ip)]:\(port)") }
            else if !ip.contains(":"), !ip.hasPrefix("169.254.") { urls.insert("http://\(ip):\(port)") }
        }
        return urls.sorted()
    }
}
