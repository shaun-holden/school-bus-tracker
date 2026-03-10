import Foundation

struct Contact: Codable, Identifiable {
    let id: String
    let name: String
    let role: String
}

struct Conversation: Codable, Identifiable {
    var id: String { recipientId }
    let recipientId: String
    let recipientName: String
    let lastMessage: String
    let unreadCount: Int
    let lastMessageAt: String
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let senderId: String
    let recipientId: String
    let content: String
    let isRead: Bool
    let createdAt: String

    var formattedTime: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: createdAt) else { return "" }

        let timeFormatter = DateFormatter()
        timeFormatter.timeStyle = .short
        return timeFormatter.string(from: date)
    }
}

struct MessageUnreadCount: Codable {
    let count: Int
}
