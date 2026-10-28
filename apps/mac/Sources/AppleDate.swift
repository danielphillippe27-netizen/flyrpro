import Foundation

struct AppleDate {
    static func parse(_ raw: String) -> Date? {
        guard raw.count <= 64 else { return nil }
        let precise = ISO8601DateFormatter(); precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return precise.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    }
}
