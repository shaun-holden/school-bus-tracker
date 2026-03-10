import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authViewModel: AuthViewModel

    @State private var email = ""
    @State private var password = ""
    @State private var isRegistering = false
    @State private var firstName = ""
    @State private var lastName = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Logo / Header
                    VStack(spacing: 8) {
                        Image(systemName: "bus.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.blue)
                        Text("SchoolBus Tracker")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        Text("Keep track of your child's bus")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.top, 40)

                    // Form
                    VStack(spacing: 16) {
                        if isRegistering {
                            HStack(spacing: 12) {
                                TextField("First Name", text: $firstName)
                                    .textFieldStyle(.roundedBorder)
                                TextField("Last Name", text: $lastName)
                                    .textFieldStyle(.roundedBorder)
                            }
                        }

                        TextField("Email", text: $email)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)

                        SecureField("Password", text: $password)
                            .textFieldStyle(.roundedBorder)
                            .textContentType(isRegistering ? .newPassword : .password)

                        if let error = authViewModel.errorMessage {
                            Text(error)
                                .font(.caption)
                                .foregroundColor(.red)
                                .multilineTextAlignment(.center)
                        }

                        Button {
                            Task {
                                if isRegistering {
                                    await authViewModel.register(
                                        email: email,
                                        password: password,
                                        firstName: firstName.isEmpty ? nil : firstName,
                                        lastName: lastName.isEmpty ? nil : lastName
                                    )
                                } else {
                                    await authViewModel.login(email: email, password: password)
                                }
                            }
                        } label: {
                            if authViewModel.isSubmitting {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                            } else {
                                Text(isRegistering ? "Create Account" : "Sign In")
                                    .fontWeight(.semibold)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(email.isEmpty || password.isEmpty || authViewModel.isSubmitting)

                        Button {
                            withAnimation {
                                isRegistering.toggle()
                                authViewModel.errorMessage = nil
                            }
                        } label: {
                            Text(isRegistering
                                 ? "Already have an account? Sign In"
                                 : "Don't have an account? Register")
                                .font(.subheadline)
                        }
                    }
                    .padding(.horizontal, 24)
                }
            }
            .navigationBarHidden(true)
        }
    }
}
