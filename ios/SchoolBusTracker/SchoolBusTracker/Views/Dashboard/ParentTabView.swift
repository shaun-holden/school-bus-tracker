import SwiftUI

struct ParentTabView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @StateObject private var dashboardVM = DashboardViewModel()
    @StateObject private var notificationsVM = NotificationsViewModel()
    @StateObject private var messagingVM = MessagingViewModel()

    var body: some View {
        TabView {
            DashboardView(viewModel: dashboardVM)
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            TrackingView(viewModel: dashboardVM)
                .tabItem {
                    Label("Track", systemImage: "map.fill")
                }

            NotificationsView(viewModel: notificationsVM)
                .tabItem {
                    Label("Alerts", systemImage: "bell.fill")
                }
                .badge(dashboardVM.unreadNotificationCount)

            MessagingListView(viewModel: messagingVM)
                .tabItem {
                    Label("Messages", systemImage: "message.fill")
                }
                .badge(dashboardVM.unreadMessageCount)

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
        .task {
            await dashboardVM.loadAll()
            dashboardVM.startAutoRefresh()
        }
        .onDisappear {
            dashboardVM.stopAutoRefresh()
        }
    }
}
