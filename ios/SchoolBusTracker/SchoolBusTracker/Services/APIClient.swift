import Foundation

enum APIError: LocalizedError {
    case unauthorized
    case forbidden
    case notFound
    case serverError(String)
    case networkError(Error)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Please log in again"
        case .forbidden: return "You don't have permission to do that"
        case .notFound: return "Not found"
        case .serverError(let msg): return msg
        case .networkError(let err): return err.localizedDescription
        case .decodingError(let err): return "Data error: \(err.localizedDescription)"
        }
    }
}

class APIClient {
    static let shared = APIClient()

    // IMPORTANT: Update this to your Railway deployment URL
    #if DEBUG
    private let baseURL = "https://successful-creation-production.up.railway.app"
    #else
    private let baseURL = "https://successful-creation-production.up.railway.app"
    #endif

    private let session: URLSession
    private let decoder: JSONDecoder

    private init() {
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.httpCookieStorage = HTTPCookieStorage.shared
        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()
    }

    // MARK: - Core Request Methods

    func get<T: Decodable>(_ path: String) async throws -> T {
        return try await request(path, method: "GET")
    }

    func post<T: Decodable>(_ path: String, body: Encodable? = nil) async throws -> T {
        return try await request(path, method: "POST", body: body)
    }

    func patch<T: Decodable>(_ path: String, body: Encodable? = nil) async throws -> T {
        return try await request(path, method: "PATCH", body: body)
    }

    func delete<T: Decodable>(_ path: String) async throws -> T {
        return try await request(path, method: "DELETE")
    }

    // Fire-and-forget POST (no response body needed)
    func post(_ path: String, body: Encodable? = nil) async throws {
        let _: EmptyResponse = try await request(path, method: "POST", body: body)
    }

    // MARK: - Private

    private func request<T: Decodable>(
        _ path: String,
        method: String,
        body: Encodable? = nil
    ) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.serverError("Invalid URL: \(path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body = body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200...299:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decodingError(error)
            }
        case 401:
            throw APIError.unauthorized
        case 403:
            throw APIError.forbidden
        case 404:
            throw APIError.notFound
        default:
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError.serverError(message)
        }
    }
}

// For endpoints that return a response we don't need
private struct EmptyResponse: Decodable {}

// Generic wrapper for simple message responses
struct MessageResponse: Decodable {
    let message: String?
    let success: Bool?
}
