// Adapted from KimiCoco MacMessagesProvider.swift; see docs/mac-companion/audit.md.
import Foundation
import SQLite3
#if os(macOS)
import AppKit
#endif

struct NormalizedMacMessage: Encodable {
    let rowID: Int64
    let guid: String
    let handle: String
    let body: String?
    let direction: String
    let service: String?
    let sentAt: String?
    let hasAttachments: Bool
}

enum MacMessageError: LocalizedError {
    case unavailable(String), unsupported(String)
    var errorDescription: String? {
        switch self {
        case .unavailable(let detail): "Messages unavailable: \(detail)"
        case .unsupported(let detail): "Unsupported Messages capability: \(detail)"
        }
    }
}

struct MacMessagesProvider {
    func requestPermission() -> String {
        "WolfGrid cannot grant Full Disk Access itself. Add the signed WolfGrid app in System Settings → Privacy & Security → Full Disk Access, then return and check again."
    }

    func checkReadAccess() throws {
        // A permission and schema check only: no handle and no message rows are selected.
        let path = NSHomeDirectory() + "/Library/Messages/chat.db"
        var database: OpaquePointer?
        guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            let detail = database.map { String(cString: sqlite3_errmsg($0)) } ?? "Permission denied or database missing"
            sqlite3_close(database)
            throw MacMessageError.unavailable(detail)
        }
        defer { sqlite3_close(database) }
        let requirements: [(String, Set<String>)] = [
            ("message", ["ROWID","guid","text","attributedBody","handle_id","date","is_from_me","service","cache_has_attachments"]),
            ("handle", ["ROWID","id"]), ("chat", ["ROWID","guid","display_name"]),
            ("chat_handle_join", ["chat_id","handle_id"]), ("chat_message_join", ["chat_id","message_id"]),
            ("attachment", ["ROWID","guid","filename","transfer_name","mime_type","total_bytes"]),
            ("message_attachment_join", ["message_id","attachment_id"])
        ]
        for (table, expected) in requirements {
            var statement: OpaquePointer?
            defer { sqlite3_finalize(statement) }
            guard sqlite3_prepare_v2(database, "PRAGMA table_info(\(table))", -1, &statement, nil) == SQLITE_OK else {
                throw MacMessageError.unsupported("Could not inspect \(table)")
            }
            var columns = Set<String>()
            while sqlite3_step(statement) == SQLITE_ROW {
                if let raw = sqlite3_column_text(statement, 1) { columns.insert(String(cString: raw)) }
            }
            guard expected.isSubset(of: columns) else {
                throw MacMessageError.unsupported("The local \(table) schema changed; sync is paused")
            }
        }
    }


}


// History uses its own cursor; importing older rows never skips the selected-thread test.
struct MacHistoryAttachment: Codable, Sendable {
    let guid: String
    let fileName: String
    let mimeType: String?
    let byteCount: Int64
    var status: String
    var storagePath: String?
    var localPath: String? = nil
    enum CodingKeys: String, CodingKey { case guid, fileName, mimeType, byteCount, status, storagePath }
}

struct MacHistoryMessage: Encodable, Sendable {
    let rowID: Int64
    let guid: String
    let conversationID: String
    let conversationName: String?
    let participants: [String]
    let sender: String?
    let body: String?
    let bodyStatus: String
    let direction: String
    let service: String?
    let sentAt: String?
    var attachments: [MacHistoryAttachment]
}

// Read the length-delimited NSString payload, never instantiate archived Objective-C classes.
// Unsupported archive layouts stay visible as unavailable rather than guessed text.
enum MacMessageBodyDecoder {
    static func decode(_ data: Data) -> String? {
        let bytes = [UInt8](data)
        guard bytes.count >= 16, bytes.count <= 8_000_000,
              data.prefix(16).range(of: Data("streamtyped".utf8)) != nil,
              let marker = data.range(of: Data([0x01, 0x2b])),
              data[..<marker.lowerBound].range(of: Data("NSString".utf8)) != nil else { return nil }
        var position = marker.upperBound
        guard position < bytes.count else { return nil }
        let tag = bytes[position]; position += 1
        let size: Int
        switch tag {
        case 0...0x7f: size = Int(tag)
        case 0x81:
            guard position + 2 <= bytes.count else { return nil }
            size = Int(bytes[position]) | Int(bytes[position + 1]) << 8; position += 2
        case 0x82:
            guard position + 4 <= bytes.count else { return nil }
            size = (0..<4).reduce(0) { $0 | Int(bytes[position + $1]) << (8 * $1) }; position += 4
        default: return nil
        }
        guard size <= 1_000_000, position + size <= bytes.count,
              position + size < bytes.count, bytes[position + size] == 0x86 else { return nil }
        return String(bytes: bytes[position..<(position + size)], encoding: .utf8)
    }
}

extension MacMessagesProvider {
    func historyBatch(after cursor: Int64, databasePath: String? = nil, allowedIdentifiers: Set<String>, indexedChats: [String: [Int64]]? = nil, notBefore: Date? = nil) throws -> [MacHistoryMessage] {
        try historyPage(after: cursor, databasePath: databasePath, allowedIdentifiers: allowedIdentifiers, indexedChats: indexedChats, notBefore: notBefore).messages
    }

    func historyPage(after cursor: Int64, databasePath: String? = nil, allowedIdentifiers: Set<String>, indexedChats: [String: [Int64]]? = nil, notBefore: Date? = nil) throws -> MacHistoryPage {
        guard cursor >= 0 else { throw MacMessageError.unsupported("Invalid history cursor") }
        if databasePath == nil && indexedChats == nil { try checkReadAccess() }
        var database: OpaquePointer?
        let path = databasePath ?? NSHomeDirectory() + "/Library/Messages/chat.db"
        guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            sqlite3_close(database); throw MacMessageError.unavailable("Cannot open Messages history read-only")
        }
        defer { sqlite3_close(database) }
        // A scan indexes participants once; reads select bodies only from approved one-to-one chats.
        let index = try indexedChats ?? participantIndex(databasePath: databasePath)
        // Revalidate candidate participants inside the same read snapshot as the body query.
        guard sqlite3_exec(database, "BEGIN", nil, nil, nil) == SQLITE_OK else { throw MacMessageError.unavailable("Cannot begin read snapshot") }
        defer { sqlite3_exec(database, "ROLLBACK", nil, nil, nil) }
        let candidates = Set(allowedIdentifiers.flatMap { index[$0] ?? [] })
        var ids = Set<Int64>()
        for chat in candidates {
            let members = try historyParticipants(database, chatID: chat)
            if members.count == 1, let raw = members.first, let normalized = Self.normalizedIdentifier(raw), allowedIdentifiers.contains(normalized) { ids.insert(chat) }
        }
        guard !ids.isEmpty else { return MacHistoryPage(messages: [], scannedThrough: cursor) }
        let chatFilter = " AND c.ROWID IN (" + ids.map(String.init).joined(separator: ",") + ")"
        // One row per message. Shared chat joins must not truncate a page halfway through a ROWID.
        let sql = """
        SELECT m.ROWID,m.guid,c.guid,c.display_name,m.text,m.attributedBody,m.is_from_me,m.service,m.date,h.id,c.ROWID
        FROM message m JOIN chat_message_join cmj ON cmj.message_id=m.ROWID
        JOIN chat c ON c.ROWID=cmj.chat_id LEFT JOIN handle h ON h.ROWID=m.handle_id
        WHERE m.ROWID > ? AND (? IS NULL OR m.date >= ?)\(chatFilter) AND cmj.chat_id=(SELECT min(chat_id) FROM chat_message_join WHERE message_id=m.ROWID)
        ORDER BY m.ROWID LIMIT 100
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
            throw MacMessageError.unsupported("Messages history schema changed")
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int64(statement, 1, cursor)
        if let notBefore {
            let cutoff = Int64((notBefore.timeIntervalSince1970 - 978307200) * 1_000_000_000)
            sqlite3_bind_int64(statement, 2, cutoff); sqlite3_bind_int64(statement, 3, cutoff)
        } else { sqlite3_bind_null(statement, 2); sqlite3_bind_null(statement, 3) }
        var result: [MacHistoryMessage] = []
        while true {
            let code = sqlite3_step(statement)
            if code == SQLITE_DONE { break }
            guard code == SQLITE_ROW else { throw MacMessageError.unavailable("History read failed") }
            func text(_ i: Int32) -> String? { sqlite3_column_text(statement, i).map { String(cString: $0) } }
            let row = sqlite3_column_int64(statement, 0)
            var body = text(4)
            let blobSize = Int(sqlite3_column_bytes(statement, 5))
            if body == nil || body == "", let blob = sqlite3_column_blob(statement, 5), blobSize > 0 {
                body = MacMessageBodyDecoder.decode(Data(bytes: blob, count: blobSize))
            }
            let members = try historyParticipants(database, chatID: sqlite3_column_int64(statement, 10))
            let date = sqlite3_column_int64(statement, 8)
            result.append(MacHistoryMessage(rowID: row, guid: text(1) ?? "", conversationID: text(2) ?? "",
                conversationName: text(3), participants: members, sender: text(9), body: body,
                bodyStatus: body != nil ? "decoded" : blobSize > 0 ? "unsupported" : "empty",
                direction: sqlite3_column_int(statement, 6) == 1 ? "outgoing" : "incoming", service: text(7),
                sentAt: date > 0 ? ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: Double(date) / 1_000_000_000 + 978307200)) : nil,
                attachments: try historyAttachments(database, rowID: row)))
        }
        var through = result.last?.rowID ?? cursor
        if result.count < 100 {
            var maximum: OpaquePointer?
            defer { sqlite3_finalize(maximum) }
            let maximumSQL = "SELECT max(message_id) FROM chat_message_join WHERE chat_id IN (" + ids.map(String.init).joined(separator: ",") + ")"
            guard sqlite3_prepare_v2(database, maximumSQL, -1, &maximum, nil) == SQLITE_OK, sqlite3_step(maximum) == SQLITE_ROW else { throw MacMessageError.unavailable("Could not acknowledge scanned history") }
            through = max(through, sqlite3_column_int64(maximum, 0))
        }
        return MacHistoryPage(messages: result, scannedThrough: through)
    }

    private func historyAttachments(_ database: OpaquePointer?, rowID: Int64) throws -> [MacHistoryAttachment] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "SELECT a.guid,a.filename,a.transfer_name,a.mime_type,a.total_bytes FROM attachment a JOIN message_attachment_join j ON j.attachment_id=a.ROWID WHERE j.message_id=? ORDER BY a.ROWID", -1, &statement, nil) == SQLITE_OK else { throw MacMessageError.unsupported("Attachment schema changed") }
        defer { sqlite3_finalize(statement) }; sqlite3_bind_int64(statement, 1, rowID)
        var values: [MacHistoryAttachment] = []
        while true {
            let code = sqlite3_step(statement); if code == SQLITE_DONE { break }
            guard code == SQLITE_ROW else { throw MacMessageError.unavailable("Attachment read failed") }
            func text(_ i: Int32) -> String? { sqlite3_column_text(statement, i).map { String(cString: $0) } }
            let local = text(1).map { ($0 as NSString).expandingTildeInPath }
            let root = URL(fileURLWithPath: NSHomeDirectory() + "/Library/Messages/Attachments").resolvingSymlinksInPath().path + "/"
            let resolved = local.map { URL(fileURLWithPath: $0).resolvingSymlinksInPath().path }
            let available = resolved.map { $0.hasPrefix(root) && FileManager.default.isReadableFile(atPath: $0) } ?? false
            values.append(MacHistoryAttachment(guid: text(0) ?? "", fileName: text(2) ?? local.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "Attachment",
                mimeType: text(3), byteCount: sqlite3_column_int64(statement, 4), status: available ? "pending" : "unavailable",
                storagePath: nil, localPath: available ? resolved : nil))
        }
        return values
    }

    static func normalizedIdentifier(_ raw: String) -> String? {
        let clean = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.range(of: "^[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+$", options: .regularExpression) != nil { return clean.lowercased() }
        guard clean.range(of: "^\\+?[0-9() .-]+$", options: .regularExpression) != nil else { return nil }
        let digits = clean.filter { $0.isASCII && $0.isNumber }
        if digits.count == 10 { return "+1" + digits }
        if digits.count == 11 && digits.first == "1" { return "+" + digits }
        if clean.hasPrefix("+") && (8...15).contains(digits.count) { return "+" + digits }
        return nil
    }

    private func historyParticipants(_ database: OpaquePointer?, chatID: Int64) throws -> [String] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "SELECT DISTINCT h.id FROM chat_handle_join j JOIN handle h ON h.ROWID=j.handle_id WHERE j.chat_id=? ORDER BY h.id", -1, &statement, nil) == SQLITE_OK else { throw MacMessageError.unsupported("Participant schema changed") }
        defer { sqlite3_finalize(statement) }; sqlite3_bind_int64(statement, 1, chatID)
        var values: [String] = []
        while true {
            let code = sqlite3_step(statement); if code == SQLITE_DONE { break }
            guard code == SQLITE_ROW else { throw MacMessageError.unavailable("Participant read failed") }
            if let raw = sqlite3_column_text(statement, 0) { values.append(String(cString: raw)) }
        }
        return values
    }

    private func hasAttachments(_ database: OpaquePointer?, rowID: Int64) throws -> Bool {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "SELECT 1 FROM message_attachment_join WHERE message_id=? LIMIT 1", -1, &statement, nil) == SQLITE_OK else { throw MacMessageError.unsupported("Attachment schema changed") }
        defer { sqlite3_finalize(statement) }; sqlite3_bind_int64(statement, 1, rowID)
        let code = sqlite3_step(statement)
        guard code == SQLITE_ROW || code == SQLITE_DONE else { throw MacMessageError.unavailable("Attachment flag read failed") }
        return code == SQLITE_ROW
    }

    func participantIndex(databasePath: String? = nil) throws -> [String: [Int64]] {
        if databasePath == nil { try checkReadAccess() }
        var database: OpaquePointer?
        guard sqlite3_open_v2(databasePath ?? NSHomeDirectory() + "/Library/Messages/chat.db", &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            sqlite3_close(database); throw MacMessageError.unavailable("Cannot open Messages read-only")
        }
        defer { sqlite3_close(database) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "SELECT j.chat_id,h.id FROM chat_handle_join j JOIN handle h ON h.ROWID=j.handle_id", -1, &statement, nil) == SQLITE_OK else { throw MacMessageError.unsupported("Participant schema changed") }
        defer { sqlite3_finalize(statement) }
        var chats: [Int64: Set<String>] = [:]
        while true {
            let code = sqlite3_step(statement); if code == SQLITE_DONE { break }
            guard code == SQLITE_ROW else { throw MacMessageError.unavailable("Participant index failed") }
            if let raw = sqlite3_column_text(statement, 1) { chats[sqlite3_column_int64(statement, 0), default: []].insert(String(cString: raw)) }
        }
        var result: [String: [Int64]] = [:]
        for (chat, participants) in chats {
            guard participants.count == 1, let raw = participants.first, let handle = Self.normalizedIdentifier(raw) else { continue }
            result[handle, default: []].append(chat)
        }
        return result
    }
}

extension MacMessagesProvider {
    /// Metadata only. Unknown participants and message bodies never leave the Mac.
    func conversationPreview(allowedIdentifiers: Set<String>, databasePath: String? = nil) throws -> [String: Any] {
        if databasePath == nil { try checkReadAccess() }
        let index = try participantIndex(databasePath: databasePath)
        var database: OpaquePointer?
        guard sqlite3_open_v2(databasePath ?? NSHomeDirectory() + "/Library/Messages/chat.db", &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { sqlite3_close(database); throw MacMessageError.unavailable("Messages metadata unavailable") }
        defer { sqlite3_close(database) }
        var ids = Set<Int64>()
        for id in Set(allowedIdentifiers.flatMap { index[$0] ?? [] }) {
            let members = try historyParticipants(database, chatID: id)
            if members.count == 1, let raw = members.first, let normalized = Self.normalizedIdentifier(raw), allowedIdentifiers.contains(normalized) { ids.insert(id) }
        }
        guard !ids.isEmpty else { return ["conversationCount": 0, "messageCount": 0, "lastMessageAt": NSNull()] }
        var statement: OpaquePointer?
        let sql = "SELECT count(distinct m.ROWID),max(m.date) FROM message m JOIN chat_message_join j ON j.message_id=m.ROWID WHERE j.chat_id IN (" + ids.map(String.init).joined(separator: ",") + ")"
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { throw MacMessageError.unsupported("Messages metadata schema changed") }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { throw MacMessageError.unavailable("Could not check the conversation") }
        let date = sqlite3_column_int64(statement, 1)
        return ["conversationCount": ids.count, "messageCount": Int(sqlite3_column_int64(statement, 0)), "lastMessageAt": date > 0 ? ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: Double(date) / 1_000_000_000 + 978307200)) : NSNull()]
    }
}


struct MacHistoryPage: Sendable {
    let messages: [MacHistoryMessage]
    let scannedThrough: Int64
}
extension MacMessagesProvider {
    func latestRows(index: [String: [Int64]], databasePath: String? = nil) throws -> [String: Int64] {
        let ids = Set(index.values.flatMap { $0 }); guard !ids.isEmpty else { return [:] }
        var database: OpaquePointer?
        guard sqlite3_open_v2(databasePath ?? NSHomeDirectory() + "/Library/Messages/chat.db", &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { sqlite3_close(database); throw MacMessageError.unavailable("Cannot inspect Messages changes") }
        defer { sqlite3_close(database) }
        var statement: OpaquePointer?
        let sql = "SELECT chat_id,max(message_id) FROM chat_message_join WHERE chat_id IN (" + ids.map(String.init).joined(separator: ",") + ") GROUP BY chat_id"
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { throw MacMessageError.unsupported("Messages change index unavailable") }
        defer { sqlite3_finalize(statement) }
        var latest: [Int64: Int64] = [:]
        while sqlite3_step(statement) == SQLITE_ROW { latest[sqlite3_column_int64(statement, 0)] = sqlite3_column_int64(statement, 1) }
        return index.mapValues { ($0.compactMap { latest[$0] }).max() ?? 0 }
    }
}
