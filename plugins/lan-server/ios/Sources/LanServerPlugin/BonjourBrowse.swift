import Foundation

/// NetService and NetServiceBrowser are scheduled on the main run loop.
final class BonjourBrowse: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    private let browser = NetServiceBrowser()
    private var pending: [String: NetService] = [:]
    private var resolved: [String: [String: Any]] = [:]
    private var completion: ((Result<[[String: Any]], Error>) -> Void)?
    private var deadline: DispatchWorkItem?

    func start(timeout: TimeInterval, completion: @escaping (Result<[[String: Any]], Error>) -> Void) throws {
        guard self.completion == nil else { throw NSError(domain: "LanServer", code: 2, userInfo: [NSLocalizedDescriptionKey: "A Bonjour scan is already running"]) }
        self.completion = completion
        browser.delegate = self
        let deadline = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.finish(.success(self.resolved.keys.sorted().compactMap { self.resolved[$0] }))
        }
        self.deadline = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: deadline)
        browser.searchForServices(ofType: LanTransport.serviceType, inDomain: "local.")
    }
    func cancel() {
        finish(.failure(NSError(domain: "LanServer", code: 3, userInfo: [NSLocalizedDescriptionKey: "Bonjour scan canceled by stop"])))
    }
    private func finish(_ result: Result<[[String: Any]], Error>) {
        guard let callback = completion else { return }
        completion = nil; deadline?.cancel(); deadline = nil
        browser.stop(); browser.delegate = nil
        for service in pending.values { service.stop(); service.delegate = nil }
        pending.removeAll(); resolved.removeAll()
        callback(result)
    }
    private func key(_ service: NetService) -> String { service.domain + service.type + service.name }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        guard completion != nil, pending.count < 32 else { return }
        pending[key(service)] = service
        service.delegate = self
        service.resolve(withTimeout: 2)
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        let id = key(service)
        let previous = pending.removeValue(forKey: id); previous?.stop(); previous?.delegate = nil
        resolved.removeValue(forKey: id)
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        finish(.failure(NSError(domain: "LanServer", code: 4, userInfo: [NSLocalizedDescriptionKey: "Bonjour search failed: \(errorDict)"])))
    }
    func netServiceDidResolveAddress(_ service: NetService) {
        guard completion != nil, pending[key(service)] === service,
              let host = service.hostName, service.port > 0, service.port <= 65535 else { return }
        var components = URLComponents()
        components.scheme = "http"; components.host = host; components.port = service.port
        guard let url = components.url?.absoluteString else { return }
        resolved[key(service)] = ["name": service.name, "urls": [url]]
    }
}
