import SwiftUI
import SwiftData

struct HomeView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \PinNode.timestamp, order: .reverse) private var pins: [PinNode]

    @State private var viewModel = HomeViewModel()
    @State private var searchText = ""

    private var filteredPins: [PinNode] {
        guard !searchText.isEmpty else { return pins }
        let query = searchText.lowercased()
        return pins.filter { pin in
            pin.queryText.lowercased().contains(query) ||
            pin.conversationTitle.lowercased().contains(query) ||
            (pin.answerSnippet?.lowercased().contains(query) ?? false) ||
            pin.platform.lowercased().contains(query)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if pins.isEmpty {
                    EmptyStateView()
                } else {
                    pinList
                }
            }
            .navigationTitle("PageMark")
            .searchable(text: $searchText, prompt: "Search pinned messages")
        }
    }

    private var pinList: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(viewModel.groupedPins(filteredPins), id: \.title) { group in
                    conversationSection(group)
                }
            }
            .padding(.horizontal)
            .padding(.top, 8)
        }
    }

    private func conversationSection(
        _ group: (title: String, platform: String, pins: [PinNode])
    ) -> some View {
        DisclosureGroup {
            ForEach(group.pins) { pin in
                PinCardView(
                    pin: pin,
                    platformLabel: viewModel.platformLabel(for: pin.platform),
                    platformIcon: viewModel.platformIcon(for: pin.platform)
                )
                .onTapGesture {
                    viewModel.restore(pin)
                }
                .contextMenu {
                    Button {
                        viewModel.restore(pin)
                    } label: {
                        Label("Open in Safari", systemImage: "safari")
                    }

                    if let url = viewModel.restoreURL(for: pin) {
                        Button {
                            viewModel.copyToClipboard(url.absoluteString)
                        } label: {
                            Label("Copy URL", systemImage: "doc.on.doc")
                        }
                    }

                    Button {
                        viewModel.copyToClipboard(pin.queryText)
                    } label: {
                        Label("Copy Query", systemImage: "text.quote")
                    }

                    Divider()

                    Button(role: .destructive) {
                        withAnimation(.spring(duration: 0.35)) {
                            modelContext.delete(pin)
                        }
                    } label: {
                        Label("Delete Pin", systemImage: "trash")
                    }
                    .accessibilityLabel("Delete pin: \(pin.queryText)")
                }
                .transition(.asymmetric(
                    insertion: .scale(scale: 0.9).combined(with: .opacity),
                    removal: .scale(scale: 0.9).combined(with: .opacity)
                ))
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: viewModel.platformIcon(for: group.platform))
                    .font(.subheadline)
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)

                Text(group.title)
                    .font(.headline)
                    .lineLimit(1)

                Spacer()

                Text("\(group.pins.count)")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(.fill.tertiary, in: Capsule())
                    .accessibilityHidden(true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(group.title), \(viewModel.platformLabel(for: group.platform)), \(group.pins.count) pins")
        }
        .tint(.primary)
    }
}

#Preview {
    HomeView()
        .modelContainer(for: PinNode.self, inMemory: true)
}
