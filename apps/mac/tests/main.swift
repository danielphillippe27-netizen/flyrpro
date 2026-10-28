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
