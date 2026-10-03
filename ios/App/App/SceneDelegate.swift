import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // Main.storyboard (UISceneStoryboardFile) builds the window and its AppViewController root; this only forwards to Capacitor.
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// Debug (Xcode Debug config) only: exposes an empty DebugBuild plugin so the web app's Capacitor.isPluginAvailable('DebugBuild') can show developer tools. Registered before the page loads, so its header is injected at document start.
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        #if DEBUG
        bridge?.registerPluginInstance(DebugBuildPlugin())
        #endif
    }
}

@objc(DebugBuildPlugin)
class DebugBuildPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "DebugBuildPlugin"
    let jsName = "DebugBuild"
    let pluginMethods: [CAPPluginMethod] = []
}
