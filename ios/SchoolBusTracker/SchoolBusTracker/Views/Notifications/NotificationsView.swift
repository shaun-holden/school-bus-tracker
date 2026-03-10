import SwiftUI

struct NotificationsView: View {
    @ObservedObject var viewModel: NotificationsViewModel
    @State private var selectedTab = "unread"

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Tab selector
                Picker("", selection: $selectedTab) {
                    Text("Unread (\(viewModel.unreadNotifications.count))")
                        .tag("unread")
                    Text("All (\(viewModel.notifications.count))")
                        .tag("all")
                }
                .pickerStyle(.segmented)
                .padding()

                if viewModel.isLoading {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else {
                    let items = selectedTab == "unread"
                        ? viewModel.unreadNotifications
                        : viewModel.notifications

                    if items.isEmpty {
                        Spacer()
                        VStack(spacing: 12) {
                            Image(systemName: "bell.slash")
                                .font(.system(size: 48))
                                .foregroundColor(.secondary)
                            Text("No Notifications")
                                .font(.headline)
                            Text("You're all caught up!")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                    } else {
                        List {
                            ForEach(items) { notification in
                                NotificationRow(notification: notification) {
                                    Task {
                                        await viewModel.markAsRead(notification.id)
                                    }
                                }
                            }
                        }
                        .listStyle(.plain)
                    }
                }
            }
            .navigationTitle("Notifications")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    if !viewModel.unreadNotifications.isEmpty {
                        Button("Mark All Read") {
                            Task { await viewModel.markAllAsRead() }
                        }
                    }
                }
            }
            .task {
                await viewModel.load()
            }
            .refreshable {
                await viewModel.load()
            }
        }
    }
}

struct NotificationRow: View {
    let notification: ParentNotification
    let onMarkRead: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            notificationIcon
                .frame(width: 36, height: 36)
                .background(iconBackground)
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(notification.title)
                        .font(.subheadline)
                        .fontWeight(notification.isRead == true ? .regular : .bold)
                    Spacer()
                    Text(notification.formattedDate)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }

                Text(notification.message)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)

                if let delay = notification.estimatedDelay, delay > 0 {
                    Text("Estimated delay: \(delay) min")
                        .font(.caption2)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.orange.opacity(0.15))
                        .foregroundColor(.orange)
                        .cornerRadius(4)
                }
            }
        }
        .padding(.vertical, 4)
        .opacity(notification.isRead == true ? 0.7 : 1.0)
        .swipeActions(edge: .trailing) {
            if notification.isRead != true {
                Button("Read") { onMarkRead() }
                    .tint(.blue)
            }
        }
    }

    private var notificationIcon: some View {
        Group {
            switch notification.notificationType {
            case .emergency:
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.red)
            case .delay:
                Image(systemName: "clock.fill")
                    .foregroundColor(.orange)
            case .routeChange:
                Image(systemName: "arrow.triangle.turn.up.right.diamond.fill")
                    .foregroundColor(.blue)
            case .info:
                Image(systemName: "info.circle.fill")
                    .foregroundColor(.gray)
            }
        }
    }

    private var iconBackground: Color {
        switch notification.notificationType {
        case .emergency: return .red.opacity(0.15)
        case .delay: return .orange.opacity(0.15)
        case .routeChange: return .blue.opacity(0.15)
        case .info: return .gray.opacity(0.15)
        }
    }
}
