import Foundation

func archive(_ text: String) -> Data {
    let bytes = Array(text.utf8)
    var prefix = Array("\u{04}\u{0b}streamtypedNSString".utf8) + [0x01, 0x2b]
    if bytes.count < 128 { prefix += [UInt8(bytes.count)] }
    else if bytes.count < 65536 { prefix += [0x81, UInt8(bytes.count & 255), UInt8(bytes.count >> 8)] }
    else { prefix += [0x82] + (0..<4).map { UInt8((bytes.count >> ($0 * 8)) & 255) } }
    return Data(prefix + bytes + [0x86,0x84])
}
for text in ["Hello", "🌹 Café", String(repeating: "long message ", count: 40), String(repeating: "a", count: 70000), ""] {
    precondition(MacMessageBodyDecoder.decode(archive(text)) == text)
}
precondition(MacMessageBodyDecoder.decode(Data([1,43,255])) == nil)
precondition(MacMessageBodyDecoder.decode(archive("hello").dropLast(3)) == nil)
let path = CommandLine.arguments[1]
let provider = MacMessagesProvider()
let matched = try provider.historyBatch(after: 0, databasePath: path, allowedIdentifiers: ["+19055550101"])
precondition(matched.count == 1 && matched[0].guid == "matched-body", "Only the one-to-one match may import")
let none = try provider.historyBatch(after: 0, databasePath: path, allowedIdentifiers: [])
precondition(none.isEmpty)
precondition(MacMessagesProvider.normalizedIdentifier("(905) 555-0101") == "+19055550101")
precondition(MacMessagesProvider.normalizedIdentifier(" Person@Example.com ") == "person@example.com")
precondition(MacMessagesProvider.normalizedIdentifier("123") == nil)
print("Passed: groups and unmatched contacts excluded before body/attachment reads; identifier normalization.")

precondition(MacMessagesProvider.normalizedIdentifier("1234567890 ext 99") == nil)
precondition(MacMessagesProvider.normalizedIdentifier("bad@email") == nil)
let encoded = try JSONEncoder().encode(matched)
precondition(!String(decoding: encoded, as: UTF8.self).contains("localPath"))

let index = try provider.participantIndex(databasePath: path)
precondition(index["+19055550101"] == [2])
// An old scan cannot authorize a group or a chat whose participant changed.
let stale = try provider.historyBatch(after: 0, databasePath: path, allowedIdentifiers: ["+19055550101"], indexedChats: ["+19055550101": [1,2,3]])
precondition(stale.count == 1 && stale[0].guid == "matched-body")
print("Passed: a cached scan revalidates participants before bodies; stale group/unknown chats stay excluded.")

let attempt = UUID().uuidString
let authOrigin = URL(string: "https://auth.example.com")!
var oauthURL = URLComponents(string: "https://auth.example.com/auth/v1/authorize")!
oauthURL.queryItems = [URLQueryItem(name: "provider", value: "google"), URLQueryItem(name: "redirect_to", value: "wolfgrid-mac://auth/callback?attempt=\(attempt)"), URLQueryItem(name: "code_challenge", value: String(repeating: "a", count: 43)), URLQueryItem(name: "code_challenge_method", value: "s256")]
let validRequest = oauthURL.url!.absoluteString
precondition(MacOAuthPolicy.authorizationURL(validRequest, attempt: attempt, authOrigin: authOrigin) != nil)
precondition(MacOAuthPolicy.authorizationURL(validRequest.replacingOccurrences(of: "auth.example.com", with: "attacker.example.com"), attempt: attempt, authOrigin: authOrigin) == nil)
precondition(MacOAuthPolicy.authorizationURL(validRequest + "&access_token=secret", attempt: attempt, authOrigin: authOrigin) == nil)
precondition(MacOAuthPolicy.authorizationURL(validRequest + "&provider=apple", attempt: attempt, authOrigin: authOrigin) == nil)
precondition(MacOAuthPolicy.authorizationURL(validRequest, attempt: UUID().uuidString, authOrigin: authOrigin) == nil)
precondition(MacOAuthPolicy.authorizationURL(validRequest.replacingOccurrences(of: "s256", with: "plain"), attempt: attempt, authOrigin: authOrigin) == nil)
let callback = "wolfgrid-mac://auth/callback?attempt=\(attempt)&code=01234567-1234-1234-1234-123456789abc"
let destination = MacOAuthPolicy.completionURL(URL(string: callback)!, attempt: attempt, webOrigin: URL(string: "https://pilot.example.com")!)!
precondition(destination.host == "pilot.example.com" && destination.path == "/auth/callback")
precondition(URLComponents(url: destination, resolvingAgainstBaseURL: false)!.queryItems!.contains(URLQueryItem(name: "next", value: "/settings/mac")))
for invalid in [callback + "&code=another-code", callback + "#access_token=secret", callback + "&refresh_token=secret", callback.replacingOccurrences(of: attempt, with: UUID().uuidString), callback.replacingOccurrences(of: "wolfgrid-mac://auth/callback", with: "wolfgrid-mac://other/callback")] {
 precondition(MacOAuthPolicy.completionURL(URL(string: invalid)!, attempt: attempt, webOrigin: authOrigin) == nil)
}
print("Passed: OAuth provider/host/PKCE validation, per-attempt callback binding, no duplicate parameters or token forwarding, and app-origin callback routing.")

let fixtureDate = Date(timeIntervalSince1970: 800000000 + 978307200)
let excludedHistory = try provider.historyBatch(after: 0, databasePath: path, allowedIdentifiers: ["+19055550101"], notBefore: fixtureDate.addingTimeInterval(1))
precondition(excludedHistory.isEmpty, "The history window must filter rows before text is read")
let includedHistory = try provider.historyBatch(after: 0, databasePath: path, allowedIdentifiers: ["+19055550101"], notBefore: fixtureDate.addingTimeInterval(-1))
precondition(includedHistory.count == 1)
let metadata = try provider.conversationPreview(allowedIdentifiers: ["+19055550101"], databasePath: path)
precondition(metadata["conversationCount"] as? Int == 1 && metadata["messageCount"] as? Int == 1)
precondition(metadata["body"] == nil && metadata["participants"] == nil)
precondition(AppleDate.parse("2026-10-27T14:00:00.123Z") != nil)
precondition(AppleDate.parse("2026-10-27T10:00:00-04:00") == AppleDate.parse("2026-10-27T14:00:00Z"))
precondition(AppleDate.parse("not-a-date") == nil)
print("Passed: local date-range filtering before bodies, one-to-one metadata-only preview, fractional timestamps and time zones.")

let excludedPage = try provider.historyPage(after: 0, databasePath: path, allowedIdentifiers: ["+19055550101"], notBefore: fixtureDate.addingTimeInterval(1))
precondition(excludedPage.messages.isEmpty && excludedPage.scannedThrough == 102, "Date-excluded rows acknowledge progress without reading or uploading bodies")
let latestRows = try provider.latestRows(index: ["+19055550101": [2]], databasePath: path)
precondition(latestRows["+19055550101"] == 102 && latestRows.count == 1)
print("Passed: metadata change detection and date-excluded history checkpoints avoid repeated empty imports.")
