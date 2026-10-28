import AppKit
import AuthenticationServices
import WebKit

struct CocoNativeError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor final class CocoMailAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var authentication: ASWebAuthenticationSession?
    private weak var source: WKWebView?
    private var finish: ((Bool) -> Void)?
    private var timer: Timer?
    func start(_ raw: String, ticket: String, view: WKWebView) async throws -> Bool {
        guard authentication == nil, view.window != nil, ticket.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let url = URL(string: raw), url.scheme == "https", url.host == "accounts.google.com", url.path == "/o/oauth2/v2/auth",
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), let items = parts.queryItems,
              Set(items.map(\.name)).count == items.count else { throw CocoNativeError(message: "Start a fresh Gmail connection from WolfGrid.") }
        let values = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        let scopes = Set((values["scope"] ?? "").split(separator: " ").map(String.init))
        let allowed = Set(["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"])
        guard values["state"] == "coco." + ticket, values["code_challenge_method"] == "S256", values["code_challenge"]?.count == 43,
              scopes.isSubset(of: allowed), !scopes.isDisjoint(with: allowed.subtracting(["openid", "email"])),
              let redirect = URL(string: values["redirect_uri"] ?? ""), redirect.scheme == "https", redirect.host == "wolfgrid.app", redirect.path == "/api/outreach/gmail/callback" else { throw CocoNativeError(message: "Gmail setup needs the WolfGrid callback. No credentials were shared.") }
        source = view
        return await withCheckedContinuation { continuation in
            finish = { continuation.resume(returning: $0) }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "wolfgrid-mac") { [weak self] callback, _ in
                Task { @MainActor in
                    guard let self else { return }
                    let parts = callback.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
                    let rows = parts?.queryItems ?? []
                    let valid = callback?.scheme == "wolfgrid-mac" && callback?.host == "gmail" && callback?.path == "/callback" && rows.filter { $0.name == "ticket" && $0.value == ticket }.count == 1 && rows.filter { $0.name == "status" && $0.value == "ready" }.count == 1
                    self.complete(valid)
                }
            }
            session.presentationContextProvider = self
            authentication = session
            timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: false) { [weak self] _ in Task { @MainActor in self?.cancel() } }
            if !session.start() { complete(false) }
        }
    }
    private func complete(_ result: Bool) {
        let callback = finish; finish = nil; timer?.invalidate(); timer = nil; authentication = nil; source = nil; callback?(result)
    }
    func cancel() { let current = authentication; complete(false); current?.cancel() }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { source?.window ?? NSWindow() }
}
