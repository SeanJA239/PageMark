import SwiftUI
import SwiftData

@main
struct PageMarkApp: App {
    var body: some Scene {
        WindowGroup {
            HomeView()
                .frame(minWidth: 480, minHeight: 400)
        }
        .modelContainer(SharedModelContainer.shared)
        .defaultSize(width: 600, height: 500)
    }
}
