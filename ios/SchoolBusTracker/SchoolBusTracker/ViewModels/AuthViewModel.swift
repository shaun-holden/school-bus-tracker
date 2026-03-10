import Foundation

struct LoginRequest: Encodable {
    let email: String
    let password: String
}

struct RegisterRequest: Encodable {
    let email: String
    let password: String
    let firstName: String?
    let lastName: String?
    let role: String = "parent"
}

@MainActor
class AuthViewModel: ObservableObject {
    @Published var user: User?
    @Published var isLoading = true
    @Published var isAuthenticated = false
    @Published var errorMessage: String?
    @Published var isSubmitting = false

    private let api = APIClient.shared

    func checkAuth() async {
        isLoading = true
        do {
            let user: User = try await api.get("/api/auth/user")
            self.user = user
            self.isAuthenticated = true
        } catch {
            self.user = nil
            self.isAuthenticated = false
        }
        isLoading = false
    }

    func login(email: String, password: String) async {
        isSubmitting = true
        errorMessage = nil
        do {
            let user: User = try await api.post("/api/auth/login", body: LoginRequest(email: email, password: password))
            self.user = user
            self.isAuthenticated = true
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }

    func register(email: String, password: String, firstName: String?, lastName: String?) async {
        isSubmitting = true
        errorMessage = nil
        do {
            let user: User = try await api.post("/api/auth/register", body: RegisterRequest(
                email: email,
                password: password,
                firstName: firstName,
                lastName: lastName
            ))
            self.user = user
            self.isAuthenticated = true
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }

    func logout() async {
        await PushNotificationManager.shared.removeToken()
        do {
            try await api.post("/api/auth/logout")
        } catch {}
        user = nil
        isAuthenticated = false
    }
}
