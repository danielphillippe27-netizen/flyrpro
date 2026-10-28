import AuthenticationServices
import AppKit
import WebKit

@MainActor final class MacOAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var authentication: ASWebAuthenticationSession?
    private weak var source: WKWebView?
    private var attemptID: String?
    private var timeout: Timer?
    private var reply: ((Any?, String?) -> Void)?
    let origin: URL
    let authOrigin: URL
    init(origin: URL, authOrigin: URL) { self.origin = origin; self.authOrigin = authOrigin }

    func prepare(attempt: String, view: WKWebView, replyHandler: @escaping (Any?, String?) -> Void) {
        guard attemptID == nil else { replyHandler(nil, "A sign-in is already open. Finish or cancel it first."); return }
        guard UUID(uuidString: attempt) != nil, view.window != nil, view.url?.path == "/login" else { replyHandler(nil, "Open sign-in first."); return }
        source = view; attemptID = attempt
        timeout = Timer.scheduledTimer(withTimeInterval: 300, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.cancel(message: "Sign-in timed out. Please try again.") }
        }
        replyHandler(["ok": true], nil)
    }
    func cancel(attempt: String, view: WKWebView) {
        if attemptID == attempt && source === view { cancel() }
    }
    func start(rawURL: String, attempt: String, view: WKWebView, replyHandler: @escaping (Any?, String?) -> Void) {
        guard authentication == nil, attemptID == attempt, source === view else { replyHandler(nil, "Start a new sign-in from this window."); return }
        guard view.window != nil, view.url?.path == "/login",
              let url = MacOAuthPolicy.authorizationURL(rawURL, attempt: attempt, authOrigin: authOrigin) else {
            cancel(); replyHandler(nil, "Could not start secure Mac sign-in. Reopen Mac setup and try again."); return
        }
        source = view; attemptID = attempt; reply = replyHandler
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: MacOAuthPolicy.scheme) { [weak self, weak view] callback, _ in
            Task { @MainActor in
                guard let self, self.attemptID == attempt else { return }
                let finish = self.reply
                self.timeout?.invalidate(); self.timeout = nil
                self.authentication = nil; self.attemptID = nil; self.reply = nil; self.source = nil
                guard let view, view.window != nil, view.url?.path == "/login", let callback,
                      let destination = MacOAuthPolicy.completionURL(callback, attempt: attempt, webOrigin: self.origin) else {
                    finish?(nil, "Google or Apple sign-in was cancelled or could not return securely. Please try again."); return
                }
                // Exchange the single-use code using the original WebKit verifier cookie.
                // No authentication code or session token is returned to JavaScript through the bridge.
                finish?(["ok": true], nil)
                view.load(URLRequest(url: destination))
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authentication = session
        if !session.start() { cancel(message: "macOS could not open secure sign-in. Please try again.") }
    }
    func navigation(_ url: URL, view: WKWebView) {
        if source === view && url.path != "/login" { cancel() }
    }
    func closeWindow(_ id: ObjectIdentifier) {
        if let source, ObjectIdentifier(source) == id { cancel() }
    }
    func cancel(message: String = "Sign-in cancelled because this window changed or closed.") {
        timeout?.invalidate(); timeout = nil
        let session = authentication, finish = reply
        authentication = nil; attemptID = nil; reply = nil; source = nil
        session?.cancel(); finish?(nil, message)
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        source?.window ?? NSWindow()
    }
}
