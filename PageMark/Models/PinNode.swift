import Foundation
import SwiftData

@Model
final class PinNode {
    #Unique<PinNode>([\.id])

    var id: UUID
    var conversationPath: String
    var queryText: String
    var answerSnippet: String?
    var conversationTitle: String
    var platform: String
    var timestamp: Date

    init(
        id: UUID = UUID(),
        conversationPath: String,
        queryText: String,
        answerSnippet: String? = nil,
        conversationTitle: String,
        platform: String,
        timestamp: Date = .now
    ) {
        self.id = id
        self.conversationPath = conversationPath
        self.queryText = queryText
        self.answerSnippet = answerSnippet
        self.conversationTitle = conversationTitle
        self.platform = platform
        self.timestamp = timestamp
    }
}
