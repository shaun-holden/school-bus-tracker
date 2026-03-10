import Foundation
import UserNotifications
import UIKit

class PushNotificationManager: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = PushNotificationManager()

    @Published var deviceToken: String?
    @Published var hasPermission = false

    private let api = APIClient.shared

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    // Request notification permission
    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, error in
            DispatchQueue.main.async {
                self.hasPermission = granted
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
            if let error = error {
                print("Push permission error: \(error.localizedDescription)")
            }
        }
    }

    // Called when APNs returns a device token
    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        self.deviceToken = tokenString
        print("APNs device token: \(tokenString)")

        // Register token with our server
        Task {
            await registerTokenWithServer(tokenString)
        }
    }

    // Called when APNs registration fails
    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("Failed to register for push notifications: \(error.localizedDescription)")
    }

    // Register token with the backend
    private func registerTokenWithServer(_ token: String) async {
        struct TokenRequest: Encodable {
            let token: String
            let platform: String
        }

        do {
            let _: MessageResponse = try await api.post(
                "/api/device-tokens",
                body: TokenRequest(token: token, platform: "ios")
            )
            print("Device token registered with server")
        } catch {
            print("Failed to register token with server: \(error)")
        }
    }

    // Remove token on logout
    func removeToken() async {
        guard let token = deviceToken else { return }

        struct TokenRequest: Encodable {
            let token: String
        }

        do {
            let _: MessageResponse = try await api.delete("/api/device-tokens")
        } catch {
            print("Failed to remove token: \(error)")
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    // Handle notification when app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show banner + sound even when app is open
        completionHandler([.banner, .sound, .badge])
    }

    // Handle notification tap
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        print("Notification tapped: \(userInfo)")

        // Post notification for the app to handle navigation
        NotificationCenter.default.post(
            name: .pushNotificationTapped,
            object: nil,
            userInfo: userInfo
        )

        completionHandler()
    }
}

extension Notification.Name {
    static let pushNotificationTapped = Notification.Name("pushNotificationTapped")
}
