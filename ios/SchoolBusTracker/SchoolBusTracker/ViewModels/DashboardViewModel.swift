import Foundation

@MainActor
class DashboardViewModel: ObservableObject {
    @Published var students: [Student] = []
    @Published var childrenBuses: [ChildBusData] = []
    @Published var unreadNotificationCount = 0
    @Published var unreadMessageCount = 0
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let api = APIClient.shared
    private var refreshTask: Task<Void, Never>?

    func loadAll() async {
        isLoading = true
        async let studentsResult: [Student] = api.get("/api/students")
        async let busesResult: [ChildBusData] = api.get("/api/parent/children-buses")
        async let notifResult: UnreadCount = api.get("/api/parent-notifications/unread-count")
        async let msgResult: MessageUnreadCount = api.get("/api/messages/unread-count")

        do {
            students = try await studentsResult
        } catch {
            students = []
        }

        do {
            childrenBuses = try await busesResult
        } catch {
            childrenBuses = []
        }

        do {
            unreadNotificationCount = try await notifResult.unreadCount
        } catch {
            unreadNotificationCount = 0
        }

        do {
            unreadMessageCount = try await msgResult.count
        } catch {
            unreadMessageCount = 0
        }

        isLoading = false
    }

    func startAutoRefresh() {
        stopAutoRefresh()
        refreshTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000) // 15 seconds
                guard !Task.isCancelled else { break }
                await loadAll()
            }
        }
    }

    func stopAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    var nextPickupTime: String {
        let now = Date()
        let calendar = Calendar.current
        let currentMinutes = calendar.component(.hour, from: now) * 60 + calendar.component(.minute, from: now)

        var nextTime: String?
        var nextMinutes = Int.max

        for student in students {
            guard let time = student.stop?.scheduledTime else { continue }
            let parts = time.split(separator: ":").compactMap { Int($0) }
            guard parts.count >= 2 else { continue }
            let stopMinutes = parts[0] * 60 + parts[1]
            if stopMinutes >= currentMinutes && stopMinutes < nextMinutes {
                nextMinutes = stopMinutes
                nextTime = time
            }
        }

        // If no upcoming, show earliest
        if nextTime == nil {
            for student in students {
                guard let time = student.stop?.scheduledTime else { continue }
                let parts = time.split(separator: ":").compactMap { Int($0) }
                guard parts.count >= 2 else { continue }
                let stopMinutes = parts[0] * 60 + parts[1]
                if stopMinutes < nextMinutes {
                    nextMinutes = stopMinutes
                    nextTime = time
                }
            }
        }

        guard let time = nextTime else { return "Not scheduled" }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return time }
        let h = parts[0]
        let m = parts[1]
        let period = h >= 12 ? "PM" : "AM"
        let hour12 = h % 12 == 0 ? 12 : h % 12
        return "\(hour12):\(String(format: "%02d", m)) \(period)"
    }
}
