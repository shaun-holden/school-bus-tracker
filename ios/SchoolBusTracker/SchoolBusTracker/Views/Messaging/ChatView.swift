import SwiftUI

struct ChatView: View {
    @ObservedObject var viewModel: MessagingViewModel
    @EnvironmentObject var authViewModel: AuthViewModel

    let recipientId: String
    let recipientName: String

    @State private var messageText = ""

    var body: some View {
        VStack(spacing: 0) {
            // Messages list
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(viewModel.messages) { message in
                            MessageBubble(
                                message: message,
                                isCurrentUser: message.senderId == authViewModel.user?.id
                            )
                            .id(message.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.messages.count) { _ in
                    if let last = viewModel.messages.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            // Input bar
            HStack(spacing: 12) {
                TextField("Message...", text: $messageText)
                    .textFieldStyle(.roundedBorder)

                Button {
                    let text = messageText
                    messageText = ""
                    Task {
                        await viewModel.sendMessage(to: recipientId, content: text)
                    }
                } label: {
                    if viewModel.isSending {
                        ProgressView()
                    } else {
                        Image(systemName: "paperplane.fill")
                            .foregroundColor(.blue)
                    }
                }
                .disabled(messageText.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.isSending)
            }
            .padding()
            .background(.ultraThinMaterial)
        }
        .navigationTitle(recipientName)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadMessages(recipientId: recipientId)
        }
    }
}

struct MessageBubble: View {
    let message: ChatMessage
    let isCurrentUser: Bool

    var body: some View {
        HStack {
            if isCurrentUser { Spacer(minLength: 60) }

            VStack(alignment: isCurrentUser ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .font(.subheadline)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(isCurrentUser ? Color.blue : Color(.systemGray5))
                    .foregroundColor(isCurrentUser ? .white : .primary)
                    .cornerRadius(18)

                Text(message.formattedTime)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            if !isCurrentUser { Spacer(minLength: 60) }
        }
    }
}
