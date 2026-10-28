import SwiftUI
import WebKit
import Contacts

@main struct WolfGridMac: App {
    @StateObject private var bridge = Bridge()
    @Environment(\.openWindow) private var openWindow
    var body: some Scene {
        WindowGroup(id: "wolfgrid") {
            WolfGridWebView(bridge: bridge).frame(minWidth: 1000, minHeight: 720)
        }
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Mac setup…") { bridge.openMacSetup() }.keyboardShortcut(",", modifiers: .command)
            }
            CommandMenu("Navigate") {
                Button("Inbox") { bridge.openCrmPage("inbox") }.keyboardShortcut("1", modifiers: .command)
                Button("Contacts") { bridge.openCrmPage("contacts") }.keyboardShortcut("2", modifiers: .command)
                Divider()
                Button("Check Messages access") { bridge.showAccessStatus() }
            }
        }
        MenuBarExtra("WolfGrid", systemImage: "network") {
            Text("WolfGrid for Mac")
            Text(bridge.runtimeState)
            Divider()
            Button("Open WolfGrid") { openWindow(id: "wolfgrid"); NSApp.activate() }
            Button("Inbox") { bridge.openCrmPage("inbox"); NSApp.activate() }
            Button("Contacts") { bridge.openCrmPage("contacts"); NSApp.activate() }
            Button("Mac setup…") { bridge.openMacSetup(); NSApp.activate() }
            Button("Check Messages access") { bridge.showAccessStatus() }
            Toggle("Keep running in menu bar", isOn: Binding(get: { bridge.backgroundEnabled }, set: { value in try? bridge.configureBackground(value) })).disabled(!bridge.hasSession)
            Divider()
            Button("Quit WolfGrid") { NSApp.terminate(nil) }
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
    private let cocoMailAuth = CocoMailAuth()
    private let cocoMessages = CocoMessages()
    private let cocoAttachments = CocoAttachmentUpload()
    private lazy var oauth = MacOAuth(origin: origin, authOrigin: URL(string: Bundle.main.object(forInfoDictionaryKey: "WolfGridAuthOrigin") as? String ?? "https://kfnsnwqylsdsbgnwgxva.supabase.co")!)
    private let apple = AppleServices()
    @Published var backgroundEnabled = false
    @Published var runtimeState = "Paused"
    var hasSession: Bool { !session.isEmpty }
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
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.toolbar = nil
        closeObservers[id] = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.detachWindow(id) }
        }
    }
    func detachWindow(_ id: ObjectIdentifier) {
        oauth.closeWindow(id)
        windows.remove(id); entryWindows.remove(id); visibleViews.removeValue(forKey: id)
        if let observer = closeObservers.removeValue(forKey: id) { NotificationCenter.default.removeObserver(observer) }
        if windows.isEmpty && !backgroundEnabled { stopRuntime() }
    }
    func startURL(for view: WKWebView) -> URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "WolfGridPilotEntryURL") as? String,
           let url = URL(string: raw), trusted(url), url.path == "/" {
            entryWindows.insert(ObjectIdentifier(view)); return url
        }
        return origin.appendingPathComponent("inbox")
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if entryWindows.remove(ObjectIdentifier(webView)) != nil {
            webView.load(URLRequest(url: origin.appendingPathComponent("inbox")))
        }
    }
    func openCrmPage(_ path: String) {
        guard ["inbox","contacts","settings/integrations/apple"].contains(path) else { return }
        let views = visibleViews.values.compactMap { $0.value }
        let view = views.first { $0.window?.isKeyWindow == true } ?? (views.count == 1 ? views.first : nil)
        view?.load(URLRequest(url: origin.appendingPathComponent(path)))
    }
    func openMacSetup() {
        let views = visibleViews.values.compactMap { $0.value }
        let view = views.first { $0.window?.isKeyWindow == true } ?? (views.count == 1 ? views.first : nil)
        view?.load(URLRequest(url: origin.appendingPathComponent("settings/integrations/apple")))
    }
    func configureBackground(_ enabled: Bool) throws {
        guard !session.isEmpty else { throw MacMessageError.unavailable("Open WolfGrid and sign in first") }
        let consentScope = session
        if enabled && !backgroundEnabled {
            let alert = NSAlert(); alert.messageText = "Keep WolfGrid running in the menu bar?"
            alert.informativeText = "The Mac app can continue synchronizing your approved CRM conversations after the last window closes. Your Messages consent still applies. Quitting WolfGrid or signing out stops the connection."
            alert.addButton(withTitle: "Keep running"); alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { throw MacMessageError.unavailable("Background mode was not enabled") }
        }
        guard session == consentScope else { throw MacMessageError.unavailable("Your account or workspace changed. Background mode was not changed.") }
        UserDefaults.standard.set(enabled, forKey: "wolfgrid-background:" + session); backgroundEnabled = enabled
        if windows.isEmpty && !enabled { stopRuntime() }
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
        // Native menus provide navigation; suppress duplicate web headers.
        let trustedOrigin = String(data: try! JSONEncoder().encode(origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))), encoding: .utf8)!
        let chrome = """
            if (location.origin === \(trustedOrigin)) {
                const installChrome = () => {
                    if (!document.documentElement) return false;
                    document.documentElement.classList.add('wolfgrid-native');
                    const style = document.createElement('style');
                    style.textContent = `
                        html.wolfgrid-native .app-shell > header,
                        html.wolfgrid-native .coco-crm .mac-titlebar { display:none !important; }
                        html.wolfgrid-native .coco-crm {
                            min-height:100dvh;
                            --coco-height:100dvh;
                        }
                        html.wolfgrid-native .coco-crm .inbox-shell,
                        html.wolfgrid-native .coco-crm .inbox-shell.show-thread { height:100dvh; }
                        html.wolfgrid-native .coco-crm .contacts-workspace { min-height:100dvh; }
                    `;
                    document.documentElement.appendChild(style);
                    return true;
                };
                if (!installChrome()) {
                    const observer = new MutationObserver(() => { if (installChrome()) observer.disconnect(); });
                    observer.observe(document, {childList:true});
                }
            }
            """
        config.userContentController.addUserScript(WKUserScript(source: chrome, injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
        cocoMailAuth.cancel(); cocoMessages.clear(); cocoAttachments.clear()
        generation += 1; approved = []; chats = [:]; scanID = ""; session = ""
        backgroundEnabled = false; runtimeState = "Paused"
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
        backgroundEnabled = UserDefaults.standard.bool(forKey: "wolfgrid-background:" + identity)
        let view = makeWebView(); runtime = view
        var url = URLComponents(url: origin.appendingPathComponent("mac-sync"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "userId", value: user), URLQueryItem(name: "workspaceId", value: workspace)]
        view.load(URLRequest(url: url.url!))
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in _ = try? await self?.runtime?.evaluateJavaScript("void window.wolfgridSyncTick?.()") }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if trusted(url) {
            oauth.navigation(url, view: webView)
            if webView !== runtime && url.path == "/login" { stopRuntime() }
            decisionHandler(.allow)
        }
        else {
            decisionHandler(.cancel)
            if webView !== runtime && ["https", "mailto", "tel"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            if webView !== runtime && ["facetime", "sms"].contains(url.scheme ?? "") && action.navigationType == .linkActivated && action.sourceFrame.isMainFrame && trusted(action.sourceFrame.request.url) { NSWorkspace.shared.open(url) }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url), trusted(message.webView?.url),
              let input = message.body as? [String: Any], let action = input["action"] as? String else { replyHandler(nil, "Untrusted WolfGrid frame"); return }
        let fromRuntime = message.webView === runtime && message.webView?.url?.path == "/mac-sync"
        if ["oauth-prepare", "oauth", "oauth-cancel"].contains(action) {
            guard !fromRuntime, message.webView?.url?.path == "/login", let view = message.webView,
                  let attempt = input["attempt"] as? String else { replyHandler(nil, "Open sign-in first."); return }
            if action == "oauth-prepare" { stopRuntime(); oauth.prepare(attempt: attempt, view: view, replyHandler: replyHandler); return }
            if action == "oauth-cancel" { oauth.cancel(attempt: attempt, view: view); replyHandler(["ok": true], nil); return }
            guard let raw = input["url"] as? String else { oauth.cancel(attempt: attempt, view: view); replyHandler(nil, "Missing sign-in request."); return }
            oauth.start(rawURL: raw, attempt: attempt, view: view, replyHandler: replyHandler); return
        }
        if action == "session", !fromRuntime, let user = input["userId"] as? String, let workspace = input["workspaceId"] as? String {
            startRuntime(user: user, workspace: workspace); replyHandler(["ok": true], nil); return
        }
        if action == "session-stop" && !fromRuntime || action == "invalidate" && fromRuntime { stopRuntime(); replyHandler(["ok": true], nil); return }
        if action == "clear-approval" { cocoAttachments.clear(); generation += 1; approved = []; chats = [:]; scanID = ""; replyHandler(["ok": true], nil); return }
        if action == "status" {
            var result = apple.status(); result["deviceId"] = deviceID
            result["agentVersion"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
            result["historyRanges"] = true; result["backgroundEnabled"] = backgroundEnabled
            do { try MacMessagesProvider().checkReadAccess(); result["messagesAllowed"] = true; result["status"] = "ready" }
            catch MacMessageError.unsupported { result["messagesAllowed"] = false; result["status"] = "schema_changed" }
            catch { result["messagesAllowed"] = false; result["status"] = "permission_required" }
            replyHandler(result, nil); return
        }
        if action == "runtime-state", fromRuntime, let state = input["status"] as? String {
            let states = ["paused": "Paused", "syncing": "Syncing approved conversations", "connected": "Monitoring approved conversations", "idle": "Waiting for the next sync check", "permission_required": "Messages permission needed", "authentication_required": "Sign-in needed", "schema_changed": "Messages update needed", "offline": "Offline · retrying", "error": "Mac update needed"]
            guard let title = states[state] else { replyHandler(nil, "Invalid runtime state"); return }
            runtimeState = title; replyHandler(["ok": true], nil); return
        }
        guard !busy else { replyHandler(nil, "A Mac operation is already running"); return }
        guard fromRuntime || ["/settings/mac", "/settings/integrations/apple", "/messages", "/inbox", "/contacts", "/leads"].contains(message.webView?.url?.path ?? "") else { replyHandler(nil, "Open Mac settings"); return }
        busy = true; let started = generation, startedSession = session
        Task { @MainActor in
            defer { busy = false }
            do {
                let result: Any
                switch action {
                case "sync-now":
                    guard !fromRuntime, !session.isEmpty, let runtime else { throw MacMessageError.unavailable("Sign in and open Mac setup first") }
                    _ = try await runtime.evaluateJavaScript("void window.wolfgridSyncNow?.()")
                    result = ["requested": true]
                case "calendar-connect", "reminders-connect", "calendar-save", "reminders-save", "background-setting", "login-setting", "phone-call", "open-messages":
                    guard !fromRuntime, let user = input["userId"] as? String, let workspace = input["workspaceId"] as? String,
                          session == user + ":" + workspace, UUID(uuidString: user) != nil, UUID(uuidString: workspace) != nil else { throw MacMessageError.unavailable("Your account or workspace changed") }
                    if action.hasSuffix("-connect") { try await apple.connect(reminders: action == "reminders-connect"); result = ["connected": true] }
                    else if action.hasSuffix("-save") { result = try apple.exportItem(reminders: action == "reminders-save", input: input, scope: session, stillAuthorized: { self.session == startedSession }) }
                    else if action == "background-setting" || action == "login-setting" {
                        guard let enabled = input["enabled"] as? Bool else { throw MacMessageError.unsupported("Choose a setting") }
                        if action == "background-setting" { try configureBackground(enabled) } else { try apple.setLogin(enabled: enabled) }
                        result = ["ok": true]
                    } else {
                        guard let identifier = input["identifier"] as? String else { throw MacMessageError.unsupported("Choose a CRM phone or email") }
                        result = try apple.handoff(identifier: identifier, name: input["contactName"] as? String ?? "CRM contact", phone: action == "phone-call", stillAuthorized: { self.session == startedSession })
                    }
                case "message-preview":
                    guard !fromRuntime, let handles = input["identifiers"] as? [String], !handles.isEmpty, handles.count <= 100,
                          handles.allSatisfy({ MacMessagesProvider.normalizedIdentifier($0) == $0 }) else { throw MacMessageError.unsupported("Choose unique CRM identifiers") }
                    let identifiers = Set(handles)
                    result = try await Task.detached { try MacMessagesProvider().conversationPreview(allowedIdentifiers: identifiers) }.value
                case "privacy-settings":
                    let destinations = ["contacts": "Privacy_Contacts", "calendar": "Privacy_Calendars", "reminders": "Privacy_Reminders"]
                    guard !fromRuntime, let source = input["source"] as? String, let pane = destinations[source] else { throw MacMessageError.unsupported("Choose an Apple permission") }
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?" + pane)!); result = ["opened": true]
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
                        alert.informativeText = "WolfGrid will sync available one-to-one Messages history for your current and newly added WolfGrid contacts. Only unique phone and email matches are included. Groups and unknown people are excluded. Messages stay private to you. Pause sync in Apple Integrations at any time."
                        alert.addButton(withTitle: "Allow CRM message sync"); alert.addButton(withTitle: "Cancel")
                        guard alert.runModal() == .alertFirstButtonReturn else { throw MacMessageError.unavailable("Sync approval cancelled") }
                        UserDefaults.standard.set(consent, forKey: permissionKey)
                    }
                    let index = try await Task.detached { try MacMessagesProvider().participantIndex() }.value
                    guard generation == started else { throw MacMessageError.unavailable("Session changed") }
                    approved = Set(handles); chats = index.filter { approved.contains($0.key) }; scanID = UUID().uuidString
                    let selectedChats = chats
                    let latest = try await Task.detached { try MacMessagesProvider().latestRows(index: selectedChats) }.value
                    result = ["identifiers": Array(chats.keys), "scanId": scanID, "latestRows": latest]
                case "read":
                    guard fromRuntime, let handles = input["identifiers"] as? [String], !handles.isEmpty,
                          Set(handles).isSubset(of: approved), input["scanId"] as? String == scanID,
                          let cursor = input["cursor"] as? NSNumber, cursor.doubleValue >= 0,
                          cursor.doubleValue <= 9007199254740991, cursor.doubleValue.rounded() == cursor.doubleValue else { throw MacMessageError.unsupported("Approve CRM sync first") }
                    var cutoff: Date?
                    if let raw = input["importAfter"] as? String {
                        guard let parsed = AppleDate.parse(raw) else { throw MacMessageError.unsupported("Invalid history window") }; cutoff = parsed
                    } else if input["importAfter"] != nil && !(input["importAfter"] is NSNull) { throw MacMessageError.unsupported("Invalid history window") }
                    let index = chats, identifiers = Set(handles), after = cursor.int64Value, notBefore = cutoff
                    let page = try await Task.detached { try MacMessagesProvider().historyPage(after: after, allowedIdentifiers: identifiers, indexedChats: index, notBefore: notBefore) }.value
                    cocoAttachments.clear()
                    let messages = page.messages.map { row -> [String: Any] in
                        ["rowID": row.rowID, "guid": row.guid, "participants": row.participants, "direction": row.direction,
                         "body": row.body as Any? ?? NSNull(), "bodyStatus": row.bodyStatus, "service": row.service as Any? ?? NSNull(),
                         "sentAt": row.sentAt as Any? ?? NSNull(), "hasAttachments": !row.attachments.isEmpty, "attachments": row.attachments.map { cocoAttachments.manifest($0) }]
                    }
                    result = ["messages": messages, "scannedThrough": page.scannedThrough]
                case "attachment-upload":
                    guard fromRuntime, input["scanId"] as? String == scanID else { throw MacMessageError.unsupported("Approve CRM sync first") }
                    let expectedSession = session
                    result = try await cocoAttachments.upload(input: input, current: { [weak self] in self?.session == expectedSession && self?.scanID == input["scanId"] as? String })
                case "gmail-auth", "message-attachments", "message-clear-attachments", "message-send":
                    guard !fromRuntime, let user = input["userId"] as? String, let workspace = input["workspaceId"] as? String,
                          session == user + ":" + workspace, let view = message.webView else { throw CocoNativeError(message: "Your account or workspace changed.") }
                    if action == "gmail-auth" {
                        guard let url = input["url"] as? String, let ticket = input["ticket"] as? String else { throw CocoNativeError(message: "Start a Gmail connection first.") }
                        guard try await cocoMailAuth.start(url, ticket: ticket, view: view) else { throw CocoNativeError(message: "Gmail connection was cancelled or expired.") }
                        result = ["ok": true]
                    } else if action == "message-clear-attachments" { cocoMessages.clear(); result = ["ok": true] }
                    else if action == "message-attachments" {
                        guard let id = input["contactId"] as? String, UUID(uuidString: id) != nil else { throw CocoNativeError(message: "Choose a CRM conversation first.") }
                        result = cocoMessages.choose(contactID: id, scope: session)
                    } else { result = try await cocoMessages.send(input: input, view: view, current: { self.session == startedSession }) }
                case "contacts-review":
                    guard !fromRuntime, let user = input["userId"] as? String, let workspace = input["workspaceId"] as? String,
                          session == user + ":" + workspace, let view = message.webView, let parent = view.window,
                          let people = input["contacts"] as? [[String: Any]], people.count <= 50000 else { throw MacMessageError.unavailable("Open your current CRM contacts first") }
                    let store = CocoContactStore(user: user, workspace: workspace, contacts: people, device: deviceID, view: view, isCurrent: { self.session == startedSession })
                    let saved: Int = await withCheckedContinuation { continuation in
                        CocoContactsSheet(parent: parent, store: store, continuation: continuation).present()
                    }
                    result = ["saved": saved]
                case "contacts": result = try await chooseContacts()
                default: throw MacMessageError.unsupported("Unknown Mac action")
                }
                guard (!["scan", "read", "message-preview"].contains(action) || generation == started), session == startedSession, trusted(message.webView?.url) else { replyHandler(nil, "Session changed; result discarded"); return }
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
        guard !contacts.isEmpty else { throw MacMessageError.unavailable("No Apple Contacts are available. Check the Contacts app and the people allowed in System Settings → Privacy & Security → Contacts.") }
        let list = ContactPickerList(frame: NSRect(x: 0, y: 0, width: 520, height: contacts.count * 30))
        let selection = ContactPickerSelection()
        var checks: [NSButton] = []
        for (index, contact) in contacts.enumerated() {
            let name = (contact.givenName + " " + contact.familyName).trimmingCharacters(in: .whitespaces)
            let detail = contact.phoneNumbers.first?.value.stringValue ?? contact.emailAddresses.first.map { String($0.value) } ?? ""
            let check = NSButton(checkboxWithTitle: name + "  " + detail, target: selection, action: #selector(ContactPickerSelection.didChange(_:)))
            check.frame = NSRect(x: 8, y: index * 30, width: 504, height: 30)
            check.autoresizingMask = [.width]
            checks.append(check); list.addSubview(check)
        }
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 540, height: 350)); scroll.hasVerticalScroller = true; scroll.documentView = list
        alert.accessoryView = scroll; alert.addButton(withTitle: "Review selected"); alert.addButton(withTitle: "Cancel")
        selection.checks = checks; selection.confirm = alert.buttons.first
        selection.didChange(nil)
        scroll.contentView.scroll(to: .zero); scroll.reflectScrolledClipView(scroll.contentView)
        guard withExtendedLifetime(selection, { alert.runModal() }) == .alertFirstButtonReturn else { return [] }
        let selected = zip(contacts, checks).filter { $0.1.state == .on }
        guard selected.count <= 100 else { throw MacMessageError.unsupported("Choose at most 100 contacts at a time") }
        return selected.map { contact, _ in
            ["externalId": contact.identifier, "fullName": (contact.givenName + " " + contact.familyName).trimmingCharacters(in: .whitespaces),
             "phones": contact.phoneNumbers.map { $0.value.stringValue }, "emails": contact.emailAddresses.map { String($0.value) }]
        }
    }
}
