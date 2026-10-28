import Foundation

/// Public OAuth request validation. No passwords, access tokens or refresh tokens are accepted.
struct MacOAuthPolicy {
    static let scheme = "wolfgrid-mac"
    static func authorizationURL(_ raw: String, attempt: String, authOrigin: URL) -> URL? {
        guard UUID(uuidString: attempt) != nil, let url = URL(string: raw), raw.utf8.count < 8192,
              url.scheme == "https", url.host == authOrigin.host, url.port == authOrigin.port,
              url.user == nil, url.password == nil, url.path == "/auth/v1/authorize", url.fragment == nil,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let items = components.queryItems ?? []
        guard Set(items.map { $0.name }).count == items.count,
              !items.contains(where: { ["access_token", "refresh_token", "code", "token", "apiKey", "apikey"].contains($0.name) }),
              ["google", "apple"].contains(items.first(where: { $0.name == "provider" })?.value ?? ""),
              let challenge = items.first(where: { $0.name == "code_challenge" })?.value,
              challenge.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              items.first(where: { $0.name == "code_challenge_method" })?.value?.lowercased() == "s256",
              let redirect = items.first(where: { $0.name == "redirect_to" })?.value,
              let callback = URL(string: redirect), callback.scheme == scheme, callback.host == "auth", callback.path == "/callback",
              callback.user == nil, callback.password == nil, callback.port == nil, callback.fragment == nil,
              let callbackItems = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
              callbackItems.count == 1, callbackItems[0].name == "attempt", callbackItems[0].value == attempt else { return nil }
        return url
    }
    static func completionURL(_ callback: URL, attempt: String, webOrigin: URL) -> URL? {
        guard callback.scheme == scheme, callback.host == "auth", callback.path == "/callback",
              callback.user == nil, callback.password == nil, callback.port == nil, callback.fragment == nil,
              let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
              Set(items.map { $0.name }).count == items.count,
              items.allSatisfy({ ["attempt", "code"].contains($0.name) }),
              items.first(where: { $0.name == "attempt" })?.value == attempt,
              let code = items.first(where: { $0.name == "code" })?.value,
              code.range(of: "^[A-Za-z0-9_-]{20,2048}$", options: .regularExpression) != nil else { return nil }
        var result = URLComponents(url: webOrigin.appendingPathComponent("auth/callback"), resolvingAgainstBaseURL: false)!
        result.queryItems = [URLQueryItem(name: "code", value: code), URLQueryItem(name: "next", value: "/settings/mac")]
        return result.url
    }
}
