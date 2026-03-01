import SwiftUI

struct EmptyStateView: View {
    @State private var symbolBounce = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ContentUnavailableView {
            Label {
                Text("No Pinned Messages")
            } icon: {
                Image(systemName: "pin")
                    .font(.system(size: 48))
                    .foregroundStyle(.secondary)
                    .symbolEffect(.bounce, value: symbolBounce)
                    .onAppear {
                        if !reduceMotion {
                            symbolBounce.toggle()
                        }
                    }
            }
        } description: {
            Text("Pin important messages in your AI chats using the PageMark Safari extension.")
        } actions: {
            VStack(alignment: .leading, spacing: 16) {
                stepRow(number: 1, icon: "gearshape", text: "Open Safari > Settings > Extensions")
                stepRow(number: 2, icon: "checkmark.circle", text: "Enable PageMark")
                stepRow(number: 3, icon: "safari", text: "Visit an AI chat (Claude, ChatGPT, etc.)")
                stepRow(number: 4, icon: "pin", text: "Hover a query and click the 📌 button")
            }
            .padding(.top, 8)
        }
    }

    private func stepRow(number: Int, icon: String, text: String) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(.tint.opacity(0.15))
                    .frame(width: 32, height: 32)
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.tint)
            }
            .accessibilityHidden(true)

            Text("Step \(number): \(text)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.leading)
        }
    }
}

#Preview {
    EmptyStateView()
}
