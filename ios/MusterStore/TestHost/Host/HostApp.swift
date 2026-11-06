import SwiftUI

/// Gives the StoreKit tests a window scene to show (and auto-approve) purchase sheets in.
@main
struct HostApp: App {
    var body: some Scene {
        WindowGroup { Text("MusterStore tests") }
    }
}
