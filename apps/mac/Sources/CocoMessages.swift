import AppKit
import WebKit

@MainActor final class CocoMessages {
    private var files: [URL] = []
    private var contact = ""
    private var scope = ""
    func clear() { files = []; contact = ""; scope = "" }
    func choose(contactID: String, scope: String) -> [String: Any] {
        clear()
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
        panel.title = "Add message attachments"; panel.prompt = "Add to draft"
        guard panel.runModal() == .OK else { return ["names": []] }
        files = panel.urls; contact = contactID; self.scope = scope
        return ["names": files.map(\.lastPathComponent)]
    }
    private func recipient(user: String, workspace: String, contactID: String, view: WKWebView) async throws -> String {
        let result = try await view.callAsyncJavaScript("""
            const response=await fetch('/api/coco/recipient?workspaceId='+encodeURIComponent(workspace)+'&contactId='+encodeURIComponent(contact),{credentials:'include',cache:'no-store',headers:{'x-wolfgrid-user-id':owner}});
            const result=await response.json();return {ok:response.ok,result};
            """, arguments: ["owner": user, "workspace": workspace, "contact": contactID], in: nil, contentWorld: .page) as? [String: Any]
        guard result?["ok"] as? Bool == true, let row = result?["result"] as? [String: Any], row["id"] as? String == contactID,
              let raw = row["identifier"] as? String, MacMessagesProvider.normalizedIdentifier(raw) == raw else { throw CocoNativeError(message: "Select a CRM person with a unique phone or email before sending.") }
        return raw
    }
    func send(input: [String: Any], view: WKWebView, current: () -> Bool) async throws -> [String: Any] {
        guard let user = input["userId"] as? String, let workspace = input["workspaceId"] as? String,
              let id = input["contactId"] as? String, UUID(uuidString: id) != nil,
              let request = input["requestId"] as? String, UUID(uuidString: request) != nil,
              let body = input["body"] as? String, !body.contains("\0"), body.utf8.count <= 100000,
              !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !files.isEmpty,
              files.isEmpty || (contact == id && scope == user + ":" + workspace), current() else { throw CocoNativeError(message: "Check your contact, draft and attachments before sending.") }
        let handle = try await recipient(user: user, workspace: workspace, contactID: id, view: view)
        guard current() else { throw CocoNativeError(message: "Your account changed. Nothing was sent.") }
        let ledgerKey = "wolfgrid-send:\(user):\(workspace):\(request)"
        guard UserDefaults.standard.string(forKey: ledgerKey) == nil else { throw CocoNativeError(message: "This send was already attempted. Check Apple Messages before composing another message.") }
        UserDefaults.standard.set("attempted", forKey: ledgerKey); UserDefaults.standard.synchronize()
        func literal(_ value: String) -> String {
            "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\r", with: "\" & return & \"").replacingOccurrences(of: "\n", with: "\" & linefeed & \"").replacingOccurrences(of: "\t", with: "\" & tab & \"") + "\""
        }
        let commands = (body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? [] : ["send \(literal(body)) to targetBuddy"]) + files.map { "send POSIX file \(literal($0.path)) to targetBuddy" }
        let source = """
            tell application "Messages"
                set targetService to first service whose service type is iMessage
                set targetBuddy to buddy \(literal(handle)) of targetService
                \(commands.joined(separator: "\n"))
            end tell
            """
        var failure: NSDictionary?
        guard let script = NSAppleScript(source: source) else { throw CocoNativeError(message: "Could not prepare the message. Check Apple Messages before retrying.") }
        script.executeAndReturnError(&failure)
        guard failure == nil else { throw CocoNativeError(message: "Apple Messages did not confirm the request. Check Messages before trying again. If access was denied, allow WolfGrid in System Settings → Privacy & Security → Automation.") }
        UserDefaults.standard.set("accepted", forKey: ledgerKey); clear()
        return ["accepted": true]
    }
}
