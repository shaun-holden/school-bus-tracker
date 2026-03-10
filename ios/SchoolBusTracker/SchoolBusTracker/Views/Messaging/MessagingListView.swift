import SwiftUI

struct MessagingListView: View {
    @ObservedObject var viewModel: MessagingViewModel

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.conversations.isEmpty {
                    ProgressView()
                } else if viewModel.conversations.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "message")
                            .font(.system(size: 48))
                            .foregroundColor(.secondary)
                        Text("No Messages")
                            .font(.headline)
                        Text("Start a conversation with your child's bus driver.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                } else {
                    List(viewModel.conversations) { conversation in
                        NavigationLink {
                            ChatView(
                                viewModel: viewModel,
                                recipientId: conversation.recipientId,
                                recipientName: conversation.recipientName
                            )
                        } label: {
                            ConversationRow(conversation: conversation)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Messages")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink {
                        ContactsListView(viewModel: viewModel)
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
            .task {
                await viewModel.loadConversations()
                await viewModel.loadContacts()
            }
            .refreshable {
                await viewModel.loadConversations()
            }
        }
    }
}

struct ConversationRow: View {
    let conversation: Conversation

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "person.circle.fill")
                .font(.title)
                .foregroundColor(.blue)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(conversation.recipientName)
                        .font(.subheadline)
                        .fontWeight(conversation.unreadCount > 0 ? .bold : .regular)
                    Spacer()
                }
                Text(conversation.lastMessage)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            if conversation.unreadCount > 0 {
                Text("\(conversation.unreadCount)")
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.blue)
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 4)
    }
}

struct ContactsListView: View {
    @ObservedObject var viewModel: MessagingViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List(viewModel.contacts) { contact in
            NavigationLink {
                ChatView(
                    viewModel: viewModel,
                    recipientId: contact.id,
                    recipientName: contact.name
                )
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "person.circle.fill")
                        .font(.title2)
                        .foregroundColor(.blue)
                    VStack(alignment: .leading) {
                        Text(contact.name)
                            .font(.subheadline)
                        Text(contact.role.capitalized)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
        .navigationTitle("New Message")
    }
}
