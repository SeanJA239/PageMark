import os
import SafariServices
import SwiftData

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private let logger = Logger(subsystem: "com.seanja.PageMark.Extension", category: "handler")

    private func makeContainer() throws -> ModelContainer {
        let schema = Schema([PinNode.self])
        let config = ModelConfiguration(
            "PageMark",
            schema: schema,
            groupContainer: .identifier("group.com.seanja.PageMark")
        )
        return try ModelContainer(for: schema, configurations: [config])
    }

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]

        logger.log("Received native message: \(String(describing: message), privacy: .public)")

        guard let message = message,
              let type = message["type"] as? String else {
            respond(with: ["error": "Invalid message"], context: context)
            return
        }

        switch type {
        case "save":
            handleSave(message: message, context: context)
        case "delete":
            handleDelete(message: message, context: context)
        case "getPins":
            handleGetPins(context: context)
        case "clearAll":
            handleClearAll(context: context)
        default:
            respond(with: ["error": "Unknown message type: \(type)"], context: context)
        }
    }

    // MARK: - Save a pin

    private func handleSave(message: [String: Any], context: NSExtensionContext) {
        guard let conversationPath = message["conversationPath"] as? String,
              let queryText = message["queryText"] as? String,
              let platform = message["platform"] as? String else {
            respond(with: ["error": "Missing required fields"], context: context)
            return
        }

        let answerSnippet = message["answerSnippet"] as? String
        let conversationTitle = message["conversationTitle"] as? String ?? "Untitled"

        do {
            let container = try makeContainer()
            let modelContext = ModelContext(container)

            let node = PinNode(
                conversationPath: conversationPath,
                queryText: queryText,
                answerSnippet: answerSnippet,
                conversationTitle: conversationTitle,
                platform: platform
            )

            modelContext.insert(node)
            try modelContext.save()

            logger.log("Saved PinNode: \(queryText.prefix(50), privacy: .public) on \(platform, privacy: .public)")
            respond(with: ["success": true, "id": node.id.uuidString], context: context)
        } catch {
            logger.error("Failed to save PinNode: \(error.localizedDescription, privacy: .public)")
            respond(with: ["error": error.localizedDescription], context: context)
        }
    }

    // MARK: - Delete a pin

    private func handleDelete(message: [String: Any], context: NSExtensionContext) {
        guard let idString = message["id"] as? String,
              let uuid = UUID(uuidString: idString) else {
            respond(with: ["error": "Missing or invalid pin ID"], context: context)
            return
        }

        do {
            let container = try makeContainer()
            let modelContext = ModelContext(container)

            let predicate = #Predicate<PinNode> { $0.id == uuid }
            let descriptor = FetchDescriptor<PinNode>(predicate: predicate)
            let results = try modelContext.fetch(descriptor)

            if let node = results.first {
                modelContext.delete(node)
                try modelContext.save()
                respond(with: ["success": true], context: context)
            } else {
                respond(with: ["error": "Pin not found"], context: context)
            }
        } catch {
            logger.error("Failed to delete PinNode: \(error.localizedDescription, privacy: .public)")
            respond(with: ["error": error.localizedDescription], context: context)
        }
    }

    // MARK: - Get all pins

    private func handleGetPins(context: NSExtensionContext) {
        do {
            let container = try makeContainer()
            let modelContext = ModelContext(container)

            let descriptor = FetchDescriptor<PinNode>(
                sortBy: [SortDescriptor(\.timestamp, order: .reverse)]
            )
            let pins = try modelContext.fetch(descriptor)

            let pinsArray: [[String: Any]] = pins.map { pin in
                var dict: [String: Any] = [
                    "id": pin.id.uuidString,
                    "conversationPath": pin.conversationPath,
                    "queryText": pin.queryText,
                    "conversationTitle": pin.conversationTitle,
                    "platform": pin.platform,
                    "timestamp": pin.timestamp.timeIntervalSince1970 * 1000
                ]
                if let snippet = pin.answerSnippet {
                    dict["answerSnippet"] = snippet
                }
                return dict
            }

            respond(with: ["success": true, "pins": pinsArray], context: context)
        } catch {
            logger.error("Failed to fetch pins: \(error.localizedDescription, privacy: .public)")
            respond(with: ["error": error.localizedDescription], context: context)
        }
    }

    // MARK: - Response helper

    private func respond(with message: [String: Any], context: NSExtensionContext) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: message]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    // MARK: - Clear all pins

    private func handleClearAll(context: NSExtensionContext) {
        do {
            let container = try makeContainer()
            let modelContext = ModelContext(container)

            let descriptor = FetchDescriptor<PinNode>()
            let allPins = try modelContext.fetch(descriptor)

            for pin in allPins {
                modelContext.delete(pin)
            }
            try modelContext.save()

            logger.log("Cleared all \(allPins.count, privacy: .public) pins")
            respond(with: ["success": true, "deletedCount": allPins.count], context: context)
        } catch {
            logger.error("Failed to clear all pins: \(error.localizedDescription, privacy: .public)")
            respond(with: ["error": error.localizedDescription], context: context)
        }
    }
}
