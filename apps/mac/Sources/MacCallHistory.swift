import Foundation
import SQLite3
import CryptoKit

struct MacCallRecord: Sendable {
    let startedAt: String
    let connected: Bool
    let kind: String
    let direction: String
    let durationSeconds: Int
    let providerID: String?
}

struct MacCallHistory {
    private static let path = NSHomeDirectory() + "/Library/Application Support/CallHistoryDB/CallHistory.storedata"
    private enum ReadError: Error { case unavailable }

    func recent(identifiers: Set<String>, path: String? = nil, now: Date = Date()) throws -> [MacCallRecord] {
        guard !identifiers.isEmpty else { return [] }
        var db: OpaquePointer?
        defer { sqlite3_close(db) }
        guard sqlite3_open_v2(path ?? Self.path, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            throw ReadError.unavailable
        }
        sqlite3_busy_timeout(db, 500)
        // Core Data assigns these numeric prefixes by model version.
        let join = try participantJoin(db)
        var rows: OpaquePointer?
        defer { sqlite3_finalize(rows) }
        let sql = """
            SELECT ZADDRESS, ZDATE, ZDURATION, ZCALLTYPE, ZORIGINATED, ZUNIQUE_ID FROM ZCALLRECORD c
            WHERE ZORIGINATED IN (0,1) AND ZDATE BETWEEN ? AND ?
              AND ZADDRESS IS NOT NULL
              AND ((ZCALLTYPE = 1 AND ZSERVICE_PROVIDER = 'com.apple.Telephony')
                OR (ZCALLTYPE IN (8,16) AND ZSERVICE_PROVIDER = 'com.apple.FaceTime'))
              AND NOT EXISTS (SELECT 1 FROM \(join.table) p WHERE p.\(join.callColumn) = c.Z_PK LIMIT 1 OFFSET 1)
            ORDER BY ZDATE DESC, Z_PK DESC
            """
        guard sqlite3_prepare_v2(db, sql, -1, &rows, nil) == SQLITE_OK else { throw ReadError.unavailable }
        sqlite3_bind_double(rows, 1, now.timeIntervalSinceReferenceDate - 90 * 86400)
        sqlite3_bind_double(rows, 2, now.timeIntervalSinceReferenceDate)
        let formatter = ISO8601DateFormatter()
        var calls: [MacCallRecord] = []
        while calls.count < 10 {
            let status = sqlite3_step(rows)
            if status == SQLITE_DONE { break }
            guard status == SQLITE_ROW else { throw ReadError.unavailable }
            guard let address = sqlite3_column_text(rows, 0),
                  let handle = MacMessagesProvider.normalizedIdentifier(String(cString: address)),
                  identifiers.contains(handle) else { continue }
            let date = Date(timeIntervalSinceReferenceDate: sqlite3_column_double(rows, 1))
            let kind = sqlite3_column_int(rows, 3)
            let duration = sqlite3_column_double(rows, 2)
            let seconds = duration.isFinite && duration > 0 ? Int(min(duration.rounded(.up), 604800)) : 0
            let providerID = sqlite3_column_text(rows, 5).flatMap { value -> String? in
                let id = String(cString: value)
                guard !id.isEmpty else { return nil }
                return SHA256.hash(data: Data(id.lowercased().utf8)).map { String(format: "%02x", $0) }.joined()
            }
            calls.append(MacCallRecord(startedAt: formatter.string(from: date),
                connected: duration > 0,
                kind: kind == 8 ? "FaceTime video" : kind == 16 ? "FaceTime audio" : "Phone",
                direction: sqlite3_column_int(rows, 4) == 1 ? "outgoing" : "incoming", durationSeconds: seconds, providerID: providerID))
        }
        return calls
    }

    private func participantJoin(_ db: OpaquePointer?) throws -> (table: String, callColumn: String) {
        var tables: OpaquePointer?
        defer { sqlite3_finalize(tables) }
        guard sqlite3_prepare_v2(db, "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%REMOTEPARTICIPANTHANDLES'", -1, &tables, nil) == SQLITE_OK,
              sqlite3_step(tables) == SQLITE_ROW, let raw = sqlite3_column_text(tables, 0) else { throw ReadError.unavailable }
        let table = String(cString: raw)
        guard let range = table.range(of: #"^Z_[0-9]+REMOTEPARTICIPANTHANDLES$"#, options: .regularExpression),
              range == table.startIndex..<table.endIndex, sqlite3_step(tables) == SQLITE_DONE else { throw ReadError.unavailable }
        return (table, table.replacingOccurrences(of: "HANDLES", with: "CALLS"))
    }
}
