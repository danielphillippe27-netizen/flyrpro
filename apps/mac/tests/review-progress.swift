import Foundation
let suite = "wolfgrid-review-test-" + UUID().uuidString
let defaults = UserDefaults(suiteName: suite)!
defer { defaults.removePersistentDomain(forName: suite) }
let key = "review.owner.workspace"
defaults.set(["skipped-person"], forKey: key + ".skipped")
var progress = CocoReviewProgress.load(key: key, defaults: defaults)
precondition(progress.skipped.contains("skipped-person"))
progress.queued.insert("selected-person")
progress.targets["selected-person"] = UUID()
progress.details["selected-person"] = CocoReviewDetails(title: "Tradie", note: "Fixture note")
progress.save(key: key, defaults: defaults)
let restored = CocoReviewProgress.load(key: key, defaults: defaults)
precondition(restored.queued == progress.queued && restored.targets == progress.targets && restored.details == progress.details)
precondition(CocoReviewProgress.load(key: "review.other.workspace", defaults: defaults).queued.isEmpty)
progress.queued.remove("selected-person"); progress.reviewed.insert("selected-person"); progress.save(key: key, defaults: defaults)
precondition(CocoReviewProgress.load(key: key, defaults: defaults).queued.isEmpty)
precondition(CocoReviewProgress.load(key: key, defaults: defaults).reviewed.contains("selected-person"))
print("PASS: pending selections, match targets, labels and notes survive reopening; workspace scope and acknowledged-save progress preserved.")
