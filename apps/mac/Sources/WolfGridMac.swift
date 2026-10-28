import SwiftUI
import WebKit
import Contacts

@main struct WolfGridMac: App {
    @StateObject private var bridge = Bridge()
    var body: some Scene {
        WindowGroup {
            WolfGridWebView(bridge: bridge).frame(minWidth: 1000, minHeight: 720)
                .toolbar {
                    ToolbarItem { Button("Mac setup") { bridge.openMacSetup() } }
                    ToolbarItem { Button("Check Messages access") { bridge.showAccessStatus() } }
                }
        }
    }
}
struct WolfGridWebView: NSViewRepresentable {
    let bridge: Bridge
    func makeCoordinator() -> Bridge { bridge }
    func makeNSView(context: Context) -> WKWebView {
        let view = bridge.makeWebView()
        bridge.windows.insert(ObjectIdentifier(view))
        bridge.visibleViews[ObjectIdentifier(view)] = WeakMacView(view)
        view.load(URLRequest(url: bridge.startURL(for: view)))
        return view
    }
    func updateNSView(_ view: WKWebView, context: Context) {}
    static func dismantleNSView(_ view: WKWebView, coordinator: Bridge) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "wolfgridMac", contentWorld: .page)
        coordinator.detachWindow(ObjectIdentifier(view))
    }
}

@MainActor final class WeakMacView {
    weak var value: WKWebView?
    init(_ value: WKWebView) { self.value = value }
}

@MainActor final class MacWindowWebView: WKWebView {
    weak var connection: Bridge?
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let window { connection?.observeWindow(self, window: window) }
    }
}

@MainActor final class Bridge: NSObject, ObservableObject, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
    let origin = URL(string: Bundle.main.object(forInfoDictionaryKey: "WolfGridWebOrigin") as? String ?? "https://wolfgrid.app")!
    var windows = Set<ObjectIdentifier>()
    var visibleViews: [ObjectIdentifier: WeakMacView] = [:]
    private var entryWindows = Set<ObjectIdentifier>()
    private var closeObservers: [ObjectIdentifier: NSObjectProtocol] = [:]
    private var runtime: WKWebView?
    private var timer: Timer?
    private var session = ""
    private var approved = Set<String>()
    private var chats: [String: [Int64]] = [:]
    private var scanID = ""
    private var busy = false
    private var generation = 0
    private var deviceID: String {
        if let value = UserDefaults.standard.string(forKey: "wolfgridDeviceID") { return value }
        let value = UUID().uuidString; UserDefaults.standard.set(value, forKey: "wolfgridDeviceID"); return value
    }
    func observeWindow(_ view: WKWebView, window: NSWindow) {
        let id = ObjectIdentifier(view)
        guard windows.contains(id), closeObservers[id] == nil else { return }
        closeObservers[id] = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.detachWindow(id) }
        }
    }
    func detachWindow(_ id: ObjectIdentifier) {
        windows.remove(id); entryWindows.remove(id); visibleViews.removeValue(forKey: id)
        if let observer = closeObservers.removeValue(forKey: id) { NotificationCenter.default.removeObserver(observer) }
        if windows.isEmpty { stopRuntime() }
    }
    func startURL(for view: WKWebView) -> URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "WolfGridPilotEntryURL") as? String,
           let url = URL(string: raw), trusted(url), url.path == "/" {
            entryWindows.insert(ObjectIdentifier(view)); return url
        }
        return origin.appendingPathComponent("settings/mac")
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if entryWindows.remove(ObjectIdentifier(webView)) != nil {
            webView.load(URLRequest(url: origin.appendingPathComponent("settings/mac")))
        }
    }
    func openMacSetup() {
        let views = visibleViews.values.compactMap { $0.value }
        let view = views.first { $0.window?.isKeyWindow == true } ?? (views.count == 1 ? views.first : nil)
        view?.load(URLRequest(url: origin.appendingPathComponent("settings/mac")))
    }
    func showAccessStatus() {
        let alert = NSAlert()
        do {
            try MacMessagesProvider().checkReadAccess()
            alert.messageText = "Messages access is ready"
            alert.informativeText = "This app can open Messages read-only and the schema is supported. No message content was read by this check."
        } catch {
            alert.messageText = "Messages access needs attention"
            alert.informativeText = error.localizedDescription + "\n\nEnable WolfGrid Mac Preview in System Settings → Privacy & Security → Full Disk Access, then quit and reopen the app."
        }
        alert.addButton(withTitle: "OK"); alert.runModal()
    }
    func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = "WolfGridMac/0.2"
        config.websiteDataStore = .default()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "wolfgridMac")
        let view = MacWindowWebView(frame: .zero, configuration: config); view.connection = self; view.navigationDelegate = self
        view.allowsBackForwardNavigationGestures = true
        return view
    }
    private func trusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
    }
    func stopRuntime() {
        generation += 1; approved = []; chats = [:]; scanID = ""; session = ""
        timer?.invalidate(); timer = nil
        runtime?.stopLoading()
        runtime?.configuration.userContentController.removeScriptMessageHandler(forName: "wolfgridMac", contentWorld: .page)
        runtime = nil
    }
    private func startRuntime(user: String, workspace: String) {
        guard UUID(uuidString: user) != nil, UUID(uuidString: workspace) != nil, !windows.isEmpty else { return }
        let identity = user + ":" + workspace
        guard identity != session else { return }
        stopRuntime(); session = identity
        let view = makeWebView(); runtime = view
        var url = URLComponents(url: origin.appendingPathComponent("mac-sync"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "userId", value: user), URLQueryItem(name: "workspaceId", value: workspace)]
        view.load(URLRequest(url: url.url!))
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in _ = try? await self?.runtime?.evaluateJavaScript("void window.wolfgridSyncTick?.()") }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if trusted(url) {
            if webView !== runtime && url.path == "/login" { stopRuntime() }
            decisionHandler(.allow)
        }
        else {
            decisionHandler(.cancel)
            if webView !== runtime && ["https", "mailto", "tel"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url), trusted(message.webView?.url),
              let input = message.body as? [String: Any], let action = input["action"] as? String else { replyHandler(nil, "Untrusted WolfGrid frame"); return }
        let fromRuntime = message.webView === runtime && message.webView?.url?.path == "/mac-sync"
        if action == "session", !fromRuntime, let user = input["userId"] as? String, let workspace = input["workspaceId"] as? String {
            startRuntime(user: user, workspace: workspace); replyHandler(["ok": true], nil); return
        }
        if action == "session-stop" && !fromRuntime || action == "invalidate" && fromRuntime { stopRuntime(); replyHandler(["ok": true], nil); return }
        if action == "clear-approval" { generation += 1; approved = []; chats = [:]; scanID = ""; replyHandler(["ok": true], nil); return }
        if action == "status" {
            do { try MacMessagesProvider().checkReadAccess(); replyHandler(["deviceId": deviceID, "messagesAllowed": true, "status": "ready"], nil) }
            catch MacMessageError.unsupported { replyHandler(["deviceId": deviceID, "messagesAllowed": false, "status": "schema_changed"], nil) }
            catch { replyHandler(["deviceId": deviceID, "messagesAllowed": false, "status": "permission_required"], nil) }
            return
        }
        guard !busy else { replyHandler(nil, "A Mac operation is already running"); return }
        guard fromRuntime || message.webView?.url?.path == "/settings/mac" else { replyHandler(nil, "Open Mac settings"); return }
        busy = true; let started = generation
        Task { @MainActor in
            defer { busy = false }
            do {
                let result: Any
                switch action {
                case "settings":
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!); result = ["ok": true]
                case "scan":
                    guard fromRuntime, let handles = input["identifiers"] as? [String], !handles.isEmpty,
                          handles.allSatisfy({ MacMessagesProvider.normalizedIdentifier($0) == $0 }),
                          let user = input["userId"] as? String, let workspace = input["workspaceId"] as? String,
                          session == user + ":" + workspace, let consent = input["consent"] as? String, !consent.isEmpty else { throw MacMessageError.unsupported("Sync consent is required") }
                    let permissionKey = "crm-consent:" + session
                    if UserDefaults.standard.string(forKey: permissionKey) != consent {
                        let alert = NSAlert(); alert.messageText = "Sync messages for your WolfGrid contacts?"
                        alert.informativeText = "WolfGrid will import one-to-one conversations uniquely matching your CRM contacts, including new people you add. Groups and unknown people are excluded. Text is stored privately in your account. Pause in Mac settings at any time."
                        alert.addButton(withTitle: "Allow CRM message sync"); alert.addButton(withTitle: "Cancel")
                        guard alert.runModal() == .alertFirstButtonReturn else { throw MacMessageError.unavailable("Sync approval cancelled") }
                        UserDefaults.standard.set(consent, forKey: permissionKey)
                    }
                    let index = try await Task.detached { try MacMessagesProvider().participantIndex() }.value
                    guard generation == started else { throw MacMessageError.unavailable("Session changed") }
                    approved = Set(handles); chats = index.filter { approved.contains($0.key) }; scanID = UUID().uuidString
                    result = ["identifiers": Array(chats.keys), "scanId": scanID]
                case "read":
                    guard fromRuntime, let handles = input["identifiers"] as? [String], !handles.isEmpty,
                          Set(handles).isSubset(of: approved), input["scanId"] as? String == scanID,
                          let cursor = input["cursor"] as? NSNumber, cursor.doubleValue >= 0,
                          cursor.doubleValue <= 9007199254740991, cursor.doubleValue.rounded() == cursor.doubleValue else { throw MacMessageError.unsupported("Approve CRM sync first") }
                    let index = chats, identifiers = Set(handles), after = cursor.int64Value
                    let rows = try await Task.detached { try MacMessagesProvider().historyBatch(after: after, allowedIdentifiers: identifiers, indexedChats: index) }.value
                    result = rows.map { row -> [String: Any] in
                        ["rowID": row.rowID, "guid": row.guid, "participants": row.participants, "direction": row.direction,
                         "body": row.body as Any? ?? NSNull(), "bodyStatus": row.bodyStatus, "service": row.service as Any? ?? NSNull(),
                         "sentAt": row.sentAt as Any? ?? NSNull(), "hasAttachments": !row.attachments.isEmpty]
                    }
                case "contacts": result = try await chooseContacts()
                default: throw MacMessageError.unsupported("Unknown Mac action")
                }
                guard generation == started, trusted(message.webView?.url) else { replyHandler(nil, "Session changed; result discarded"); return }
                replyHandler(result, nil)
            } catch { replyHandler(nil, error.localizedDescription) }
        }
    }
    private func chooseContacts() async throws -> [[String: Any]] {
        let store = CNContactStore()
        guard try await store.requestAccess(for: .contacts) else { throw MacMessageError.unavailable("Allow Contacts in System Settings") }
        let keys = [CNContactIdentifierKey, CNContactGivenNameKey, CNContactFamilyNameKey, CNContactPhoneNumbersKey, CNContactEmailAddressesKey] as [CNKeyDescriptor]
        var contacts: [CNContact] = []
        try store.enumerateContacts(with: CNContactFetchRequest(keysToFetch: keys)) { contact, _ in contacts.append(contact) }
        contacts.sort { ($0.givenName + $0.familyName) < ($1.givenName + $1.familyName) }
        let alert = NSAlert(); alert.messageText = "Choose Apple Contacts"
        alert.informativeText = "Only checked people will be sent to the WolfGrid page for review. Save each person there to add them to your CRM."
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 8
        var checks: [NSButton] = []
        for contact in contacts {
            let name = (contact.givenName + " " + contact.familyName).trimmingCharacters(in: .whitespaces)
            let detail = contact.phoneNumbers.first?.value.stringValue ?? contact.emailAddresses.first.map { String($0.value) } ?? ""
            let check = NSButton(checkboxWithTitle: name + "  " + detail, target: nil, action: nil)
            checks.append(check); stack.addArrangedSubview(check)
        }
        stack.frame = NSRect(x: 0, y: 0, width: 520, height: max(1, contacts.count) * 30)
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 540, height: 350)); scroll.hasVerticalScroller = true; scroll.documentView = stack
        alert.accessoryView = scroll; alert.addButton(withTitle: "Review selected"); alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return [] }
        let selected = zip(contacts, checks).filter { $0.1.state == .on }
        guard selected.count <= 100 else { throw MacMessageError.unsupported("Choose at most 100 contacts at a time") }
        return selected.map { contact, _ in
            ["externalId": contact.identifier, "fullName": (contact.givenName + " " + contact.familyName).trimmingCharacters(in: .whitespaces),
             "phones": contact.phoneNumbers.map { $0.value.stringValue }, "emails": contact.emailAddresses.map { String($0.value) }]
        }
    }
}
