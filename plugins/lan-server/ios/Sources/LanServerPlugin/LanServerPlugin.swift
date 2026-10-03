import Foundation
import Capacitor

@objc(LanServerPlugin)
public class LanServerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LanServerPlugin"
    public let jsName = "LanServer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "browse", returnType: CAPPluginReturnPromise)
    ]
    private let transport = LanTransport()
    private let discovery = BonjourBrowse()

    public override func load() {
        transport.event = { [weak self] name, data in self?.notifyListeners(name, data: data) }
    }
    @objc public func start(_ call: CAPPluginCall) {
        guard let port = call.getDouble("port"), port.isFinite, port.rounded() == port, port >= 0, port <= 65535,
              let name = call.getString("serviceName")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !name.isEmpty, name.utf8.count <= 63, !name.contains("\0") else {
            call.reject("port must be an integer 0–65535 and serviceName must be 1–63 UTF-8 bytes"); return
        }
        DispatchQueue.main.async {
            guard let assets = Bundle.main.resourceURL?.appendingPathComponent("public", isDirectory: true) else {
                call.reject("Application resource bundle is missing"); return
            }
            do { call.resolve(["urls": try self.transport.start(port: UInt16(port), name: name, assets: assets)]) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.discovery.cancel(); self.transport.stop(); call.resolve() }
    }
    @objc public func send(_ call: CAPPluginCall) {
        guard let id = call.getString("connectionId"), let data = call.getString("data") else { call.reject("connectionId and data are required strings"); return }
        DispatchQueue.main.async {
            do { try self.transport.send(id: id, data: data); call.resolve() }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc public func browse(_ call: CAPPluginCall) {
        let timeout = call.getDouble("timeoutMs", 3000)
        guard timeout.isFinite, timeout >= 1000, timeout <= 15000 else { call.reject("timeoutMs must be between 1000 and 15000"); return }
        DispatchQueue.main.async {
            do {
                try self.discovery.start(timeout: timeout / 1000) { result in
                    switch result {
                    case .success(let services): call.resolve(["services": services])
                    case .failure(let error): call.reject(error.localizedDescription)
                    }
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }
}
