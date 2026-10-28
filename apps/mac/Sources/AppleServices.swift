import AppKit
import Contacts
import EventKit
import ServiceManagement

@MainActor final class AppleServices {
    private let store = EKEventStore()
    static func capability(_ status: EKAuthorizationStatus) -> String {
        switch status { case .fullAccess: return "connected"; case .writeOnly: return "write_only"; case .denied: return "denied"; case .restricted: return "restricted"; default: return "not_requested" }
    }
    func status() -> [String: Any] {
        let contacts = CNContactStore.authorizationStatus(for: .contacts)
        return ["contacts": contacts == .authorized || contacts.rawValue == 4 ? "connected" : contacts == .denied ? "denied" : contacts == .restricted ? "restricted" : "not_requested",
                "calendar": Self.capability(EKEventStore.authorizationStatus(for: .event)), "reminders": Self.capability(EKEventStore.authorizationStatus(for: .reminder)),
                "phoneHandoff": NSWorkspace.shared.urlForApplication(toOpen: URL(string: "tel:+10000000000")!) != nil,
                "launchAtLogin": SMAppService.mainApp.status == .enabled]
    }
    func connect(reminders: Bool) async throws {
        let alert = NSAlert(); alert.messageText = reminders ? "Connect Apple Reminders?" : "Connect Apple Calendar?"
        alert.informativeText = reminders ? "Choose a destination list when you export a WolfGrid follow-up. WolfGrid only creates or updates the CRM items you review; unrelated reminders are not imported." : "Choose a destination calendar when you export a WolfGrid appointment. macOS requires calendar access to list destinations. Your personal events are not imported."
        alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { throw MacMessageError.unavailable("Connection cancelled") }
        let allowed = try await (reminders ? store.requestFullAccessToReminders() : store.requestFullAccessToEvents())
        guard allowed else { throw MacMessageError.unavailable(reminders ? "Allow Reminders access in System Settings" : "Allow Calendars access in System Settings") }
    }
    func setLogin(enabled: Bool) throws {
        if enabled {
            let alert = NSAlert(); alert.messageText = "Open WolfGrid when you log in?"; alert.informativeText = "WolfGrid will appear in macOS Login Items. Your selected CRM permissions still apply. You can disable this here or in System Settings."
            alert.addButton(withTitle: "Open at login"); alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { throw MacMessageError.unavailable("Login item not enabled") }
            try SMAppService.mainApp.register()
            guard SMAppService.mainApp.status == .enabled else { throw MacMessageError.unavailable("Approve WolfGrid in System Settings → General → Login Items") }
        } else { try SMAppService.mainApp.unregister() }
    }
    func exportItem(reminders: Bool, input: [String: Any], scope: String, stillAuthorized: () -> Bool) throws -> [String: Any] {
        let entity: EKEntityType = reminders ? .reminder : .event
        guard EKEventStore.authorizationStatus(for: entity) == .fullAccess else { throw MacMessageError.unavailable("Connect this Apple integration first") }
        guard let rawID = input["id"] as? String, UUID(uuidString: rawID) != nil,
              let title = input["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.count <= 500,
              let rawDate = input["date"] as? String, let date = AppleDate.parse(rawDate),
              let source = input["source"] as? String, ["contact", "task"].contains(source) else { throw MacMessageError.unsupported("Invalid CRM export") }
        let contactID = input["contactId"] as? String ?? rawID
        guard UUID(uuidString: contactID) != nil else { throw MacMessageError.unsupported("Invalid contact link") }
        let calendars = store.calendars(for: entity).filter { $0.allowsContentModifications }
        guard !calendars.isEmpty else { throw MacMessageError.unavailable("No writable \(reminders ? "Reminders lists" : "calendars") are available") }
        let key = "wolfgrid-export:\(scope):\(reminders ? "reminder" : "event"):\(source):\(rawID)"
        let savedID = UserDefaults.standard.string(forKey: key)
        let existing = savedID.flatMap { store.calendarItem(withIdentifier: $0) }
        let uncertain = UserDefaults.standard.bool(forKey: key + ":pending")
        let alert = NSAlert(); alert.messageText = reminders ? "Review CRM reminder" : "Review CRM appointment"
        alert.informativeText = uncertain ? "A previous save did not finish acknowledging. Check Apple \(reminders ? "Reminders" : "Calendar") before continuing. Saving again may create a duplicate if the earlier item cannot be found." : existing != nil ? "Update the linked WolfGrid item only. Review the current Apple details below; nothing else in your calendar or list will change." : savedID != nil ? "The previously linked Apple item is no longer available. Confirm only if you want to create a replacement." : "Choose where this CRM item should go. Review the title and local date/time before saving."
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 10
        let name = NSTextField(string: existing?.title ?? title); name.frame.size = NSSize(width: 440, height: 28)
        let picker = NSDatePicker(); picker.datePickerStyle = .textFieldAndStepper; picker.datePickerElements = [.yearMonthDay, .hourMinute]; picker.dateValue = date
        let destination = NSPopUpButton(); destination.addItems(withTitles: calendars.map { "\($0.title) · \($0.source.title)" })
        if let selected = existing?.calendar, let index = calendars.firstIndex(where: { $0.calendarIdentifier == selected.calendarIdentifier }) { destination.selectItem(at: index) }
        let duration = NSPopUpButton(); duration.addItems(withTitles: ["15 minutes", "30 minutes", "60 minutes"]); duration.selectItem(at: 1)
        for view in [NSTextField(labelWithString: "Title"), name, NSTextField(labelWithString: "Date and time (\(TimeZone.current.abbreviation() ?? TimeZone.current.identifier))"), picker, NSTextField(labelWithString: reminders ? "Reminders list" : "Calendar"), destination] { stack.addArrangedSubview(view) }
        if !reminders { stack.addArrangedSubview(NSTextField(labelWithString: "Duration")); stack.addArrangedSubview(duration) }
        stack.frame = NSRect(x: 0, y: 0, width: 450, height: reminders ? 220 : 275)
        alert.accessoryView = stack; alert.addButton(withTitle: existing == nil ? "Save to Apple" : "Update linked item"); alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { throw MacMessageError.unavailable("Export cancelled. No changes were made.") }
        guard stillAuthorized(), !name.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.stringValue.count <= 500,
              calendars.indices.contains(destination.indexOfSelectedItem) else { throw MacMessageError.unavailable("Your account or workspace changed. Export cancelled.") }
        let calendar = calendars[destination.indexOfSelectedItem]
        let reference = URL(string: "https://wolfgrid.app/leads/\(contactID)")!
        // An intent marker is written first. An interrupted save is never blindly replayed.
        UserDefaults.standard.set(true, forKey: key + ":pending")
        guard UserDefaults.standard.synchronize() else { throw MacMessageError.unavailable("Could not record a safe export checkpoint") }
        if reminders {
            let reminder = (existing as? EKReminder) ?? EKReminder(eventStore: store)
            reminder.title = name.stringValue; reminder.calendar = calendar
            var components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: picker.dateValue); components.timeZone = .current
            reminder.dueDateComponents = components; if reminder.url == nil { reminder.url = reference }
            try store.save(reminder, commit: true); UserDefaults.standard.set(reminder.calendarItemIdentifier, forKey: key)
        } else {
            let event = (existing as? EKEvent) ?? EKEvent(eventStore: store)
            event.title = name.stringValue; event.calendar = calendar; event.startDate = picker.dateValue
            event.endDate = picker.dateValue.addingTimeInterval(TimeInterval([15,30,60][duration.indexOfSelectedItem] * 60)); event.timeZone = .current
            if event.url == nil { event.url = reference }
            try store.save(event, span: .thisEvent, commit: true); UserDefaults.standard.set(event.calendarItemIdentifier, forKey: key)
        }
        UserDefaults.standard.set(false, forKey: key + ":pending")
        _ = UserDefaults.standard.synchronize()
        return ["saved": true, "reviewed": true]
    }
    func handoff(identifier: String, name: String, phone: Bool, stillAuthorized: () -> Bool) throws -> [String: Any] {
        guard let normalized = MacMessagesProvider.normalizedIdentifier(identifier), normalized == identifier else { throw MacMessageError.unsupported("Choose a valid CRM identifier") }
        if phone && !normalized.hasPrefix("+") { throw MacMessageError.unsupported("A call requires a phone number") }
        let alert = NSAlert(); alert.messageText = phone ? "Call \(String(name.prefix(160)))?" : "Continue in Apple Messages?"
        alert.informativeText = phone ? "Hand \(normalized) to your Mac's calling app. macOS handles iPhone/Continuity availability. WolfGrid cannot confirm the result or duration." : "Open the conversation for \(normalized). Paste and review your draft in Apple Messages. WolfGrid will not send it."
        alert.addButton(withTitle: phone ? "Open calling app" : "Open Messages"); alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn, stillAuthorized() else { throw MacMessageError.unavailable("Handoff cancelled") }
        let url = phone ? URL(string: "tel:\(normalized)")! : normalized.hasPrefix("+") ? URL(string: "sms:\(normalized)")! : URL(fileURLWithPath: "/System/Applications/Messages.app")
        guard NSWorkspace.shared.open(url) else { throw MacMessageError.unavailable("No available app could handle this action") }
        return ["opened": true, "recipientHandedOff": normalized.hasPrefix("+"), "sent": false]
    }
}
