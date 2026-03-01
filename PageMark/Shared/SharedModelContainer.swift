import Foundation
import SwiftData

struct SharedModelContainer {
    static let shared: ModelContainer = {
        let schema = Schema([PinNode.self])
        let config = ModelConfiguration(
            "PageMark",
            schema: schema,
            groupContainer: .identifier("group.com.seanja.PageMark")
        )
        do {
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("Failed to create shared ModelContainer: \(error)")
        }
    }()
}

