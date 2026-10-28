#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
work=$(mktemp -d /tmp/wolfgrid-mac-tests.XXXXXX)
trap 'rm -rf "$work"' EXIT
python3 "$root/tests/fixture.py" "$work/fixture.db"
swiftc "$root/Sources/MacMessagesProvider.swift" "$root/Sources/MacOAuthPolicy.swift" "$root/Sources/AppleDate.swift" "$root/tests/main.swift" -o "$work/tests"
"$work/tests" "$work/fixture.db"

mkdir -p "$work/review"
cp "$root/tests/review-progress.swift" "$work/review/main.swift"
swiftc "$root/Sources/CocoReviewProgress.swift" "$work/review/main.swift" -o "$work/review/check"
"$work/review/check"
