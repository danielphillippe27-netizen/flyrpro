import SwiftUI
import Contacts

struct CocoMacContact: Identifiable {
    let id: String
    let first: String
    let last: String
    let phones: [String]
    let emails: [String]
    var name: String { "\(first) \(last)".trimmingCharacters(in: .whitespaces) }
    var phone: String { phones.first ?? "" }
    var email: String { emails.first ?? "" }
}

struct CocoContactsSetup: View {
    @EnvironmentObject private var store: CocoContactStore
    @State private var people: [CocoMacContact] = []
    @State private var query = ""
    @State private var reviewed: Set<String> = []
    @State private var skipped: Set<String> = []
    @State private var queued: Set<String> = []
    @State private var targets: [String: UUID] = [:]
    @State private var details: [String: CocoReviewDetails] = [:]
    @State private var lastSkipped: String?
    @State private var drag: CGFloat = 0
    @State private var busy = false
    @State private var loaded = false
    @State private var feedback = "Review people, then save your selected batch to WolfGrid."
    private var key: String { "wolfgrid-contact-review.\(store.userID).\(store.workspaceID?.uuidString ?? "unknown")" }
    private var remaining: [CocoMacContact] {
        people.filter { !reviewed.contains($0.id) && !skipped.contains($0.id) && !queued.contains($0.id) && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Review Apple Contacts", systemImage: "person.crop.rectangle").font(.title2.bold())
            Text("Swipe left to skip · Swipe right to select · Save below or with Done").font(.callout).foregroundStyle(.secondary)
            if !loaded {
                Button("Allow Contacts and start review") { Task { await loadContacts() } }
                    .buttonStyle(.borderedProminent).disabled(busy)
            } else {
                TextField("Find a person", text: $query).textFieldStyle(.roundedBorder).disabled(busy)
                Text("\(remaining.count) left · \(people.count) total · \(queued.count) pending save").foregroundStyle(.secondary)
                if let person = remaining.first {
                    card(person).disabled(busy)
                        .offset(x: drag).rotationEffect(.degrees(Double(drag / 30)))
                        .gesture(DragGesture(minimumDistance: 20).onChanged { if !busy { drag = $0.translation.width } }
                            .onEnded { value in
                                withAnimation { drag = 0 }
                                guard !busy else { return }
                                if value.predictedEndTranslation.width < -100 { skip(person) }
                                if value.predictedEndTranslation.width > 100 { enqueue(person) }
                            })
                    HStack {
                        Button("Skip") { skip(person) }.buttonStyle(.bordered)
                        Button("Select person") { enqueue(person) }.buttonStyle(.borderedProminent)
                            .disabled(matches(person).count > 1 && targets[person.id] == nil)
                    }.disabled(busy)
                } else {
                    Label("Review complete", systemImage: "checkmark.circle").font(.title3)
                }
                if let lastSkipped {
                    Button("Undo last skip") { skipped.remove(lastSkipped); self.lastSkipped = nil; persist() }.disabled(busy)
                }
                if !queued.isEmpty {
                    Button("Save \(queued.count) selected people") { Task { await saveBatch() } }
                        .buttonStyle(.borderedProminent).disabled(busy)
                    Button("Review selected people again") { queued.removeAll(); persist() }.disabled(busy)
                }
                if !skipped.isEmpty {
                    Button("Review skipped people") { skipped.removeAll(); lastSkipped = nil; persist() }.disabled(busy)
                }
            }
            if busy { ProgressView() }

            Text(feedback).font(.callout).foregroundStyle(.secondary)
        }
        .onReceive(store.$finishRequested) { requested in
            guard requested, !busy else { return }
            store.finishRequested = false
            Task { await saveBatch(); if queued.isEmpty { store.closeReview?() } }
        }
    }

    private func card(_ person: CocoMacContact) -> some View {
        let candidates = matches(person)
        return VStack(spacing: 12) {
            Text(String(person.name.prefix(1)).uppercased()).font(.system(size: 36, weight: .semibold))
                .frame(width: 70, height: 70).background(Color.accentColor.opacity(0.15), in: Circle())
            Text(person.name).font(.title2.bold())
            VStack(alignment: .leading, spacing: 8) {
                Text("Title / label").font(.caption).foregroundStyle(.secondary)
                TextField("e.g. Past Client, Tradie", text: Binding(get: { details[person.id]?.title ?? "" }, set: { value in
                    var entry = details[person.id] ?? CocoReviewDetails(); entry.title = String(value.prefix(60)); details[person.id] = entry; persist()
                })).textFieldStyle(.roundedBorder)
                Menu("Choose a label") {
                    ForEach(["Past Client", "Tradie", "Active Client", "Lead", "Family", "Friend"], id: \.self) { label in
                        Button(label) { var entry = details[person.id] ?? CocoReviewDetails(); entry.title = label; details[person.id] = entry; persist() }
                    }
                }
                Text("Note").font(.caption).foregroundStyle(.secondary)
                TextField("How you know them, work needed, anything useful…", text: Binding(get: { details[person.id]?.note ?? "" }, set: { value in
                    var entry = details[person.id] ?? CocoReviewDetails(); entry.note = String(value.prefix(4000)); details[person.id] = entry; persist()
                }), axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            }

            ForEach(person.phones, id: \.self) { Text($0) }
            ForEach(person.emails, id: \.self) { Text($0).font(.callout) }
            if !candidates.isEmpty {
                Text("Matches existing people by name, phone or email").font(.caption).foregroundStyle(.secondary)
                Picker("Update existing person", selection: Binding<UUID?>(get: { targets[person.id] ?? (candidates.count == 1 ? candidates.first?.id : nil) }, set: { targets[person.id] = $0; persist() })) {
                    Text("Choose a match").tag(nil as UUID?)
                    ForEach(candidates) { client in Text(client.name).tag(Optional(client.id)) }
                }
                Text("Selected matches fill missing phone/email details. Existing details are kept.").font(.caption).foregroundStyle(.secondary)
            } else {
                Label("New person", systemImage: "person.badge.plus").foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity).padding(20)
            .background(Color.gray.opacity(0.06), in: RoundedRectangle(cornerRadius: 20))
    }

    private func normalizedName(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }
    private func normalizedPhone(_ value: String) -> String {
        let digits = value.filter(\.isNumber)
        return digits.count == 11 && digits.first == "1" ? String(digits.dropFirst()) : digits
    }
    private func matches(_ person: CocoMacContact) -> [CocoNativeClient] {
        let phones = Set(person.phones.map(normalizedPhone).filter { !$0.isEmpty })
        let emails = Set(person.emails.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty })
        return store.clients.filter {
            normalizedName($0.name) == normalizedName(person.name) ||
            phones.contains(normalizedPhone($0.phone ?? "")) ||
            emails.contains(($0.email ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) ||
            $0.identifiers.contains { phones.contains(normalizedPhone($0)) || emails.contains($0.lowercased()) }
        }
    }
    private func skip(_ person: CocoMacContact) { skipped.insert(person.id); lastSkipped = person.id; persist() }
    private func enqueue(_ person: CocoMacContact) {
        let candidates = matches(person)
        guard candidates.count <= 1 || targets[person.id] != nil else { feedback = "Choose which existing person to update first."; return }
        if candidates.count == 1 { targets[person.id] = candidates[0].id }
        queued.insert(person.id); persist()
    }
    private func persist() {
        CocoReviewProgress(reviewed: reviewed, skipped: skipped, queued: queued, targets: targets, details: details).save(key: key)
        store.pendingCount = queued.count
    }
    @MainActor private func loadContacts() async {
        busy = true; store.saving = true
        defer { busy = false; store.saving = false }
        do {
            guard try await CNContactStore().requestAccess(for: .contacts) else {
                feedback = "Enable WolfGrid in System Settings → Privacy & Security → Contacts, then try again."; return
            }
            let request = CNContactFetchRequest(keysToFetch: [CNContactIdentifierKey, CNContactGivenNameKey,
                CNContactFamilyNameKey, CNContactOrganizationNameKey, CNContactPhoneNumbersKey, CNContactEmailAddressesKey].map { $0 as CNKeyDescriptor })
            var rows: [CocoMacContact] = []
            try CNContactStore().enumerateContacts(with: request) { contact, _ in
                let first = contact.givenName.isEmpty ? (contact.familyName.isEmpty ? contact.organizationName : contact.familyName) : contact.givenName
                guard !first.isEmpty else { return }
                rows.append(CocoMacContact(id: contact.identifier, first: first, last: contact.givenName.isEmpty ? "" : contact.familyName,
                    phones: contact.phoneNumbers.map { $0.value.stringValue }, emails: contact.emailAddresses.map { $0.value as String }))
            }
            people = rows.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            let progress = CocoReviewProgress.load(key: key)
            reviewed = progress.reviewed; skipped = progress.skipped; queued = progress.queued
            targets = progress.targets; details = progress.details
            store.pendingCount = queued.count
            loaded = true
            feedback = "Select matches to update existing people, or select new people to add. Done saves your selected people too. Pending selections are kept if you close or restart."
        } catch { feedback = "Could not read Contacts: \(error.localizedDescription)" }
    }
    @MainActor private func saveBatch() async {
        busy = true; store.saving = true
        defer { busy = false; store.saving = false }
        let workspace = store.workspaceID
        var saved = 0
        for person in people.filter({ queued.contains($0.id) }) {
            guard store.workspaceID == workspace else { feedback = "Workspace changed. Review your selection again."; return }
            let candidates = matches(person)
            let target = targets[person.id].flatMap { id in candidates.first { $0.id == id } } ?? (candidates.count == 1 ? candidates.first : nil)
            if candidates.count > 0 && target == nil { feedback = "Choose a match for \(person.name) before saving."; return }
            let success: Bool
            if let target {
                success = await store.save(person, target: target.id, details: details[person.id] ?? CocoReviewDetails())
            } else {
                success = await store.save(person, target: nil, details: details[person.id] ?? CocoReviewDetails())
            }
            guard success else { feedback = "Saved \(saved). \(store.errorMessage ?? "Could not save this person.") Remaining selections can be retried."; return }
            reviewed.insert(person.id); queued.remove(person.id); persist(); saved += 1
        }
        feedback = "Saved \(saved) people. Existing matches were updated without creating duplicates."
    }
}

struct CocoNativeClient: Identifiable {
    let id: UUID
    let name: String
    let phone: String?
    let email: String?
    let identifiers: [String]
}

@MainActor final class CocoContactStore: ObservableObject {
    let userID: String
    let workspaceID: UUID?
    let clients: [CocoNativeClient]
    var errorMessage: String?
    @Published var saving = false
    @Published var pendingCount = 0
    @Published var finishRequested = false
    var closeReview: (() -> Void)?
    var saved = 0
    weak var view: WKWebView?
    let deviceID: String
    let isCurrent: () -> Bool
    init(user: String, workspace: String, contacts: [[String: Any]], device: String, view: WKWebView, isCurrent: @escaping () -> Bool) {
        userID = user; workspaceID = UUID(uuidString: workspace); deviceID = device; self.view = view; self.isCurrent = isCurrent
        clients = contacts.compactMap { c in
            guard let raw = c["id"] as? String, let id = UUID(uuidString: raw), let name = c["name"] as? String else { return nil }
            return CocoNativeClient(id: id, name: name, phone: c["phone"] as? String, email: c["email"] as? String, identifiers: c["identifiers"] as? [String] ?? [])
        }
    }
    func save(_ person: CocoMacContact, target: UUID?, details: CocoReviewDetails) async -> Bool {
        guard isCurrent(), let view, let workspaceID else { errorMessage = "Your account or workspace changed. Reopen Contacts review."; return false }
        let payload: [String: Any] = ["action": "import-contact", "title": details.title, "note": details.note, "workspaceId": workspaceID.uuidString, "deviceId": deviceID, "externalId": person.id, "fullName": person.name, "phones": person.phones, "emails": person.emails, "phone": person.phone, "email": person.email, "targetId": target?.uuidString as Any? ?? NSNull()]
        do {
            let result = try await view.callAsyncJavaScript("""
                const response = await fetch('/api/mac-companion', {method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-wolfgrid-user-id':owner},body:JSON.stringify(payload)});
                const result = await response.json();
                return {ok:response.ok,error:response.ok?null:result.error};
                """, arguments: ["payload": payload, "owner": userID], in: nil, contentWorld: .page) as? [String: Any]
            guard isCurrent(), result?["ok"] as? Bool == true else { errorMessage = result?["error"] as? String ?? "Could not save this person. Your selection is kept."; return false }
            saved += 1; return true
        } catch { errorMessage = "Could not reach WolfGrid. Your selection is kept for retry."; return false }
    }
}

import WebKit

@MainActor final class CocoContactsSheet {
    private let window: NSWindow
    private weak var parent: NSWindow?
    private let store: CocoContactStore
    private var continuation: CheckedContinuation<Int, Never>?
    init(parent: NSWindow, store: CocoContactStore, continuation: CheckedContinuation<Int, Never>) {
        self.parent = parent; self.store = store; self.continuation = continuation
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 570, height: 680), styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Review Apple Contacts"
    }
    func present() {
        store.closeReview = { [weak self] in guard let self else { return }; self.parent?.endSheet(self.window) }
        let content = CocoContactsSheetView(store: store) { self.parent?.endSheet(self.window) }
        window.contentView = NSHostingView(rootView: content)
        parent?.beginSheet(window) { [self] _ in
            store.closeReview = nil; window.orderOut(nil); window.contentView = nil
            continuation?.resume(returning: store.saved); continuation = nil
        }
    }
}

private struct CocoContactsSheetView: View {
    @ObservedObject var store: CocoContactStore
    let done: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                if store.pendingCount > 0 { Text("\(store.pendingCount) selected · not saved yet").font(.callout).foregroundStyle(.secondary) }
                Spacer()
                Button(store.pendingCount > 0 ? "Save \(store.pendingCount) & Done" : "Done") {
                    if store.pendingCount > 0 { store.finishRequested = true } else { done() }
                }.buttonStyle(.borderedProminent).disabled(store.saving)
            }.padding(14)
            ScrollView { CocoContactsSetup().environmentObject(store).padding(24).frame(maxWidth: .infinity) }
        }.frame(width: 570, height: 680)
    }
}
