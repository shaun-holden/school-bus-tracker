import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageCircle, Send, ArrowLeft, Users, Loader2, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Contact {
  id: string;
  name: string;
  role: string;
}

interface Conversation {
  recipientId: string;
  recipientName: string;
  lastMessage: string;
  unreadCount: number;
  lastMessageAt: string;
}

interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
}

interface MessagingPortalProps {
  currentUserId: string;
  userRole: "parent" | "driver";
}

export function MessagingPortal({ currentUserId, userRole }: MessagingPortalProps) {
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messageText, setMessageText] = useState("");
  const [view, setView] = useState<"list" | "chat">("list");
  const [showNewMessage, setShowNewMessage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: contacts = [], isLoading: contactsLoading, isError: contactsError } = useQuery<Contact[]>({
    queryKey: ["/api/messages/contacts"],
  });

  const { data: conversations = [], isLoading: conversationsLoading, isError: conversationsError } = useQuery<Conversation[]>({
    queryKey: ["/api/messages/conversations"],
  });

  const { data: messages = [], isLoading: messagesLoading, isError: messagesError } = useQuery<Message[]>({
    queryKey: ["/api/messages/conversation", selectedContact?.id],
    enabled: !!selectedContact?.id,
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-count"],
    refetchInterval: 30000,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ recipientId, content }: { recipientId: string; content: string }) => {
      return apiRequest("/api/messages", "POST", { recipientId, content });
    },
    onSuccess: () => {
      setMessageText("");
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversation", selectedContact?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send message",
        description: error.message || "Please try again later",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = () => {
    if (!messageText.trim() || !selectedContact) return;
    sendMessageMutation.mutate({
      recipientId: selectedContact.id,
      content: messageText.trim(),
    });
  };

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact);
    setView("chat");
    queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
  };

  const handleBackToList = () => {
    setSelectedContact(null);
    setView("list");
    queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const allContacts = [...contacts];
  conversations.forEach((conv) => {
    if (!allContacts.find((c) => c.id === conv.recipientId)) {
      allContacts.push({
        id: conv.recipientId,
        name: conv.recipientName,
        role: userRole === "parent" ? "driver" : "parent",
      });
    }
  });

  if (view === "chat" && selectedContact) {
    return (
      <Card className="h-[600px] flex flex-col" data-testid="messaging-chat-view">
        <CardHeader className="border-b py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBackToList}
              data-testid="button-back-to-list"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary/10">
                {getInitials(selectedContact.name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-base" data-testid="text-contact-name">
                {selectedContact.name}
              </CardTitle>
              <p className="text-sm text-muted-foreground capitalize">
                {selectedContact.role}
              </p>
            </div>
          </div>
        </CardHeader>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messagesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : messagesError ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <AlertCircle className="h-8 w-8 text-destructive mb-2" />
                <p className="text-muted-foreground">Failed to load messages</p>
              </div>
            ) : messages.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No messages yet. Start the conversation!
              </p>
            ) : (
              messages.map((message) => {
                const isOwnMessage = message.senderId === currentUserId;
                return (
                  <div
                    key={message.id}
                    className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
                    data-testid={`message-${message.id}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-lg px-4 py-2 ${
                        isOwnMessage
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="text-sm">{message.content}</p>
                      <p
                        className={`text-xs mt-1 ${
                          isOwnMessage
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatDistanceToNow(new Date(message.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <div className="border-t p-4">
          <div className="flex gap-2">
            <Input
              placeholder="Type your message..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
              disabled={sendMessageMutation.isPending}
              data-testid="input-message"
            />
            <Button
              onClick={handleSendMessage}
              disabled={!messageText.trim() || sendMessageMutation.isPending}
              data-testid="button-send-message"
            >
              {sendMessageMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // Get contacts without existing conversations for "New Message" functionality
  const newMessageContacts = allContacts.filter(
    (c) => !conversations.find((conv) => conv.recipientId === c.id)
  );

  return (
    <Card className="h-[600px] flex flex-col" data-testid="messaging-list-view">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            <CardTitle>Messages</CardTitle>
            {(unreadData?.count ?? 0) > 0 && (
              <Badge variant="destructive" data-testid="badge-unread-count">
                {unreadData?.count}
              </Badge>
            )}
          </div>
          {allContacts.length > 0 && (
            <Button 
              size="sm" 
              onClick={() => setShowNewMessage(!showNewMessage)}
              data-testid="button-new-message"
            >
              <Send className="h-4 w-4 mr-2" />
              New Message
            </Button>
          )}
        </div>
        
        {showNewMessage && newMessageContacts.length > 0 && (
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium mb-2">Select a contact to message:</p>
            <div className="flex flex-wrap gap-2">
              {newMessageContacts.map((contact) => (
                <Button
                  key={contact.id}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    handleSelectContact(contact);
                    setShowNewMessage(false);
                  }}
                  data-testid={`new-message-${contact.id}`}
                >
                  {contact.name}
                </Button>
              ))}
            </div>
          </div>
        )}
        
        {showNewMessage && newMessageContacts.length === 0 && (
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">
              {userRole === "driver" 
                ? "All available parents are already in your conversations."
                : "All available drivers are already in your conversations."}
            </p>
          </div>
        )}
      </CardHeader>

      <ScrollArea className="flex-1">
        {contactsLoading || conversationsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : contactsError || conversationsError ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <p className="text-muted-foreground">Failed to load contacts. Please try again.</p>
          </div>
        ) : allContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {userRole === "parent"
                ? "No drivers available to message. Drivers will appear once your children are assigned to routes."
                : "No parents to message. Parents will appear when students on your routes are linked to parent accounts."}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {conversations.length > 0 && (
              <>
                {conversations.map((conv) => {
                  const contact = allContacts.find((c) => c.id === conv.recipientId) || {
                    id: conv.recipientId,
                    name: conv.recipientName,
                    role: userRole === "parent" ? "driver" : "parent",
                  };
                  return (
                    <button
                      key={conv.recipientId}
                      className="w-full p-4 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
                      onClick={() => handleSelectContact(contact)}
                      data-testid={`conversation-${conv.recipientId}`}
                    >
                      <Avatar>
                        <AvatarFallback className="bg-primary/10">
                          {getInitials(conv.recipientName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-medium truncate">{conv.recipientName}</span>
                          {conv.unreadCount > 0 && (
                            <Badge variant="destructive" className="ml-2">
                              {conv.unreadCount}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {conv.lastMessage}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(conv.lastMessageAt), {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </>
            )}

            {allContacts
              .filter((c) => !conversations.find((conv) => conv.recipientId === c.id))
              .map((contact) => (
                <button
                  key={contact.id}
                  className="w-full p-4 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => handleSelectContact(contact)}
                  data-testid={`contact-${contact.id}`}
                >
                  <Avatar>
                    <AvatarFallback className="bg-muted">
                      {getInitials(contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{contact.name}</span>
                    <p className="text-sm text-muted-foreground capitalize">
                      {contact.role}
                    </p>
                  </div>
                </button>
              ))}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}
