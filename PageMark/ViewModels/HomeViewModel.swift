import Foundation
import AppKit

@Observable
final class HomeViewModel {

    /// Platform to domain mapping
    private let platformDomains: [String: String] = [
        "claude": "claude.ai",
        "chatgpt": "chatgpt.com",
        "gemini": "gemini.google.com",
        "grok": "grok.com",
        "doubao": "www.doubao.com"
    ]

    /// Builds a restore URL that opens the conversation and scrolls to the pinned message
    func restoreURL(for pin: PinNode) -> URL? {
        guard let domain = platformDomains[pin.platform] else { return nil }
        let hash = pin.queryText.addingPercentEncoding(
            withAllowedCharacters: .urlFragmentAllowed
        ) ?? pin.queryText
        let urlString = "https://\(domain)\(pin.conversationPath)#pinboard=\(hash)"
        return URL(string: urlString)
    }

    /// Opens the restore URL in Safari
    func restore(_ pin: PinNode) {
        guard let url = restoreURL(for: pin) else { return }
        NSWorkspace.shared.open(url)
    }

    /// Copies a string to the macOS clipboard
    func copyToClipboard(_ string: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(string, forType: .string)
    }

    /// Human-readable platform label
    func platformLabel(for platform: String) -> String {
        switch platform {
        case "claude": return "Claude"
        case "chatgpt": return "ChatGPT"
        case "gemini": return "Gemini"
        case "grok": return "Grok"
        case "doubao": return "Doubao"
        default: return platform.capitalized
        }
    }

    /// SF Symbol name for a platform
    func platformIcon(for platform: String) -> String {
        switch platform {
        case "claude": return "brain.head.profile"
        case "chatgpt": return "bubble.left.and.text.bubble.right"
        case "gemini": return "sparkles"
        case "grok": return "bolt"
        case "doubao": return "ellipsis.bubble"
        default: return "globe"
        }
    }

    /// Groups pins by conversationTitle for display
    func groupedPins(_ pins: [PinNode]) -> [(title: String, platform: String, pins: [PinNode])] {
        let dict = Dictionary(grouping: pins) { $0.conversationPath }
        return dict.map { (_, pins) in
            let sorted = pins.sorted { $0.timestamp > $1.timestamp }
            return (
                title: sorted.first?.conversationTitle ?? "Untitled",
                platform: sorted.first?.platform ?? "unknown",
                pins: sorted
            )
        }
        .sorted { group1, group2 in
            guard let latest1 = group1.pins.first?.timestamp,
                  let latest2 = group2.pins.first?.timestamp else { return false }
            return latest1 > latest2
        }
    }
}
