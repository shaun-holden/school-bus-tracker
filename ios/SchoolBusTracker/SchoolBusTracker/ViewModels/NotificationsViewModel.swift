import Foundation

@MainActor
class NotificationsViewModel: ObservableObject {
    @Published var notifications: [ParentNotification] = []
    @Published var isLoading = false

    private let api = APIClient.shared

    func load() async {
        isLoading = true
        do {
            notifications = try await api.get("/api/parent-notifications")
        } catch {
            notifications = []
        }
        isLoading = false
    }

    func markAsRead(_ id: String) async {
        do {
            let _: MessageResponse = try await api.post("/api/notifications/\(id)/read")
            if let index = notifications.firstIndex(where: { $0.id == id }) {
                await load() // Reload to get updated state
            }
        } catch {}
    }

    func markAllAsRead() async {
        do {
            let _: MessageResponse = try await api.post("/api/notifications/mark-all-read")
            await load()
        } catch {}
    }

    var unreadNotifications: [ParentNotification] {
        notifications.filter { $0.isRead != true }
    }

    var readNotifications: [ParentNotification] {
        notifications.filter { $0.isRead == true }
    }
}
