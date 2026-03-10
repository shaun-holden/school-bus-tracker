import Foundation

struct SendMessageRequest: Encodable {
    let recipientId: String
    let content: String
}

@MainActor
class MessagingViewModel: ObservableObject {
    @Published var contacts: [Contact] = []
    @Published var conversations: [Conversation] = []
    @Published var messages: [ChatMessage] = []
    @Published var isLoading = false
    @Published var isSending = false
    @Published var errorMessage: String?

    private let api = APIClient.shared

    func loadContacts() async {
        do {
            contacts = try await api.get("/api/messages/contacts")
        } catch {
            contacts = []
        }
    }

    func loadConversations() async {
        isLoading = true
        do {
            conversations = try await api.get("/api/messages/conversations")
        } catch {
            conversations = []
        }
        isLoading = false
    }

    func loadMessages(recipientId: String) async {
        isLoading = true
        do {
            messages = try await api.get("/api/messages/conversation/\(recipientId)")
        } catch {
            messages = []
        }
        isLoading = false
    }

    func sendMessage(to recipientId: String, content: String) async {
        isSending = true
        errorMessage = nil
        do {
            let _: ChatMessage = try await api.post("/api/messages", body: SendMessageRequest(
                recipientId: recipientId,
                content: content
            ))
            await loadMessages(recipientId: recipientId)
            await loadConversations()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = error.localizedDescription
        }
        isSending = false
    }
}
