import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @ObservedObject var viewModel: DashboardViewModel

    @State private var linkCode = ""
    @State private var isLinkingChild = false
    @State private var linkMessage: String?
    @State private var linkSuccess = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Welcome header
                    welcomeCard

                    // Quick stats
                    statsRow

                    // Notification banner
                    if viewModel.unreadNotificationCount > 0 {
                        notificationBanner
                    }

                    // Students list
                    if viewModel.students.isEmpty && !viewModel.isLoading {
                        noStudentsCard
                    } else {
                        ForEach(viewModel.students) { student in
                            StudentCard(student: student, busData: busDataFor(student))
                        }
                    }

                    // Link code entry
                    linkCodeCard
                }
                .padding()
            }
            .navigationTitle("Dashboard")
            .refreshable {
                await viewModel.loadAll()
            }
        }
    }

    // MARK: - Subviews

    private var welcomeCard: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Welcome back,")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                Text(authViewModel.user?.displayName ?? "Parent")
                    .font(.title2)
                    .fontWeight(.bold)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("Next Pickup")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(viewModel.nextPickupTime)
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(.blue)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
    }

    private var statsRow: some View {
        HStack(spacing: 12) {
            StatBadge(
                title: "Students",
                value: "\(viewModel.students.count)",
                icon: "person.2.fill",
                color: .blue
            )
            StatBadge(
                title: "Active Buses",
                value: "\(viewModel.childrenBuses.filter { $0.bus?.status == "on_route" }.count)",
                icon: "bus.fill",
                color: .green
            )
            StatBadge(
                title: "Alerts",
                value: "\(viewModel.unreadNotificationCount)",
                icon: "bell.fill",
                color: viewModel.unreadNotificationCount > 0 ? .red : .gray
            )
        }
    }

    private var notificationBanner: some View {
        HStack {
            Image(systemName: "bell.badge.fill")
                .foregroundColor(.white)
                .font(.title3)
            VStack(alignment: .leading) {
                Text("You have \(viewModel.unreadNotificationCount) new alert\(viewModel.unreadNotificationCount == 1 ? "" : "s")")
                    .fontWeight(.semibold)
                    .foregroundColor(.white)
                Text("Tap to view notifications")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.8))
            }
            Spacer()
            Text("\(viewModel.unreadNotificationCount)")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(.white.opacity(0.2))
                .cornerRadius(20)
        }
        .padding()
        .background(
            LinearGradient(colors: [.red, .orange], startPoint: .leading, endPoint: .trailing)
        )
        .cornerRadius(12)
    }

    private var noStudentsCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.crop.circle.badge.plus")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("No Students Linked")
                .font(.headline)
            Text("Enter a link code from your school to connect your child's bus information.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    private var linkCodeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Link a Child", systemImage: "link.badge.plus")
                .font(.headline)

            HStack {
                TextField("Enter link code", text: $linkCode)
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.allCharacters)
                    .disableAutocorrection(true)

                Button {
                    Task { await linkChild() }
                } label: {
                    if isLinkingChild {
                        ProgressView()
                    } else {
                        Text("Link")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(linkCode.isEmpty || isLinkingChild)
            }

            if let message = linkMessage {
                Text(message)
                    .font(.caption)
                    .foregroundColor(linkSuccess ? .green : .red)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
    }

    // MARK: - Helpers

    private func busDataFor(_ student: Student) -> ChildBusData? {
        viewModel.childrenBuses.first { $0.student.id == student.id }
    }

    private func linkChild() async {
        isLinkingChild = true
        linkMessage = nil
        do {
            struct LinkRequest: Encodable { let code: String }
            struct LinkResponse: Decodable { let success: Bool; let message: String? }
            let response: LinkResponse = try await APIClient.shared.post("/api/link-child", body: LinkRequest(code: linkCode))
            linkSuccess = true
            linkMessage = response.message ?? "Child linked successfully!"
            linkCode = ""
            await viewModel.loadAll()
        } catch let error as APIError {
            linkSuccess = false
            linkMessage = error.errorDescription
        } catch {
            linkSuccess = false
            linkMessage = error.localizedDescription
        }
        isLinkingChild = false
    }
}

// MARK: - Supporting Views

struct StatBadge: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(color)
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
            Text(title)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(Color(.systemBackground))
        .cornerRadius(10)
        .shadow(color: .black.opacity(0.05), radius: 3, y: 1)
    }
}
