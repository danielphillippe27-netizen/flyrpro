import AppKit

// A flipped document view keeps the first contact at the top and gives every row
// an explicit visible frame, independent of NSStackView's intrinsic sizing.
@MainActor final class ContactPickerList: NSView {
    override var isFlipped: Bool { true }
}

@MainActor final class ContactPickerSelection: NSObject {
    var checks: [NSButton] = []
    weak var confirm: NSButton?
    @objc func didChange(_ sender: NSButton?) {
        let count = checks.filter { $0.state == .on }.count
        confirm?.isEnabled = count > 0 && count <= 100
        confirm?.title = count > 100 ? "Choose up to 100 contacts" : count > 0 ? "Review \(count) selected" : "Select contacts to continue"
    }
}
