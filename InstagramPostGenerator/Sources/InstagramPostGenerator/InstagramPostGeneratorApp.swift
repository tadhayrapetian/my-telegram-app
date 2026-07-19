import SwiftUI

/// Հավելվածի մուտքի կետը (macOS)։
/// The app entry point (macOS).
@main
struct InstagramPostGeneratorApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowStyle(.titleBar)
        .windowResizability(.contentMinSize)
    }
}
