import SwiftUI

struct PinCardView: View {
    let pin: PinNode
    let platformLabel: String
    let platformIcon: String

    @State private var isPressed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Query text
            Text(pin.queryText)
                .font(.subheadline)
                .fontWeight(.medium)
                .lineLimit(3)
                .foregroundStyle(.primary)

            // Answer snippet
            if let snippet = pin.answerSnippet, !snippet.isEmpty {
                Text(snippet)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 6))
            }

            // Platform + timestamp
            HStack(spacing: 4) {
                Image(systemName: platformIcon)
                    .font(.caption2)
                    .foregroundStyle(.tint)
                Text(platformLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Spacer()

                Text(pin.timestamp, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .scaleEffect(isPressed ? 0.97 : 1.0)
        .animation(reduceMotion ? nil : .spring(duration: 0.2), value: isPressed)
        .onLongPressGesture(minimumDuration: .infinity, pressing: { pressing in
            isPressed = pressing
        }, perform: {})
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityDescription)
        .accessibilityHint("Double-tap to open in Safari")
        .accessibilityAddTraits(.isButton)
    }

    private var accessibilityDescription: String {
        var parts = ["Pinned query: \(pin.queryText)"]
        if let snippet = pin.answerSnippet, !snippet.isEmpty {
            parts.append("Answer: \(snippet)")
        }
        parts.append("on \(platformLabel)")
        return parts.joined(separator: ". ")
    }
}
