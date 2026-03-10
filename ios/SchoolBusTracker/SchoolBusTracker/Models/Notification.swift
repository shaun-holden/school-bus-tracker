import Foundation

struct ParentNotification: Codable, Identifiable {
    let id: String
    let title: String
    let message: String
    let type: String
    let isRead: Bool?
    let createdAt: String
    let estimatedDelay: Int?

    var notificationType: NotificationType {
        NotificationType(rawValue: type) ?? .info
    }

    var formattedDate: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: createdAt) else { return createdAt }

        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .short
        return relative.localizedString(for: date, relativeTo: Date())
    }
}

enum NotificationType: String, Codable {
    case delay
    case emergency
    case info
    case routeChange = "route_change"
}

struct UnreadCount: Codable {
    let unreadCount: Int
}
