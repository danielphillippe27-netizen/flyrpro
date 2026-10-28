import Foundation

struct CocoReviewDetails: Codable, Equatable {
    var title = ""
    var note = ""
}
struct CocoReviewProgress: Codable {
    var reviewed: Set<String> = []
    var skipped: Set<String> = []
    var queued: Set<String> = []
    var targets: [String: UUID] = [:]
    var details: [String: CocoReviewDetails] = [:]
    static func load(key: String, defaults: UserDefaults = .standard) -> Self {
        if let data = defaults.data(forKey: key + ".progress"), let progress = try? JSONDecoder().decode(Self.self, from: data) { return progress }
        return Self(reviewed: Set(defaults.stringArray(forKey: key + ".reviewed") ?? []), skipped: Set(defaults.stringArray(forKey: key + ".skipped") ?? []))
    }
    func save(key: String, defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: key + ".progress") }
    }
}
