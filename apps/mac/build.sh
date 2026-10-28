#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
output="$root/build/WolfGrid Mac Preview.app"
mkdir -p "$output/Contents/MacOS" "$output/Contents/Resources" "$root/build/bin"
origin=${WOLFGRID_WEB_ORIGIN:-https://wolfgrid.app}
case "$origin" in
  https://wolfgrid.app|http://localhost:3000|http://127.0.0.1:3000) ;;
  https://flyrpro-*.vercel.app) if [ "${WOLFGRID_PILOT_BUILD:-false}" != true ]; then echo 'Preview origins require an explicit pilot build.'; exit 1; fi ;;
  *) echo 'Unsupported origin'; exit 1;;
esac
for architecture in arm64 x86_64; do
  swiftc -parse-as-library -swift-version 5 -O -target "${architecture}-apple-macos15.0" -framework SwiftUI -framework WebKit -framework Contacts -framework AppKit -framework AuthenticationServices -framework EventKit -framework ServiceManagement -lsqlite3 "$root"/Sources/*.swift -o "$root/build/bin/$architecture"
done
lipo -create "$root/build/bin/arm64" "$root/build/bin/x86_64" -output "$output/Contents/MacOS/WolfGridMac"
cat > "$output/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.wolfgrid.mac.preview</string>
<key>CFBundleExecutable</key><string>WolfGridMac</string><key>CFBundleName</key><string>WolfGrid Mac Preview</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.5.1</string><key>CFBundleVersion</key><string>20</string>
<key>LSMinimumSystemVersion</key><string>15.0</string><key>NSAppleEventsUsageDescription</key><string>Review each CRM recipient, message and attachment before allowing WolfGrid to send through Apple Messages.</string>
<key>NSContactsUsageDescription</key><string>Choose people to review and add to your WolfGrid CRM.</string>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>app.wolfgrid.mac.oauth</string><key>CFBundleURLSchemes</key><array><string>wolfgrid-mac</string></array></dict></array>
<key>NSCalendarsFullAccessUsageDescription</key><string>Choose a calendar and review CRM appointments before saving. Unrelated personal events are not imported.</string>
<key>NSRemindersFullAccessUsageDescription</key><string>Choose a list and review WolfGrid follow-ups before saving. Unrelated personal reminders are not imported.</string>
<key>WolfGridAuthOrigin</key><string>https://kfnsnwqylsdsbgnwgxva.supabase.co</string>
<key>WolfGridWebOrigin</key><string>$origin</string><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
iconset="$root/build/WolfGrid.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$root/../../public/wolfgrid-icon-1024.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  doubled=$((size * 2))
  sips -z "$doubled" "$doubled" "$root/../../public/wolfgrid-icon-1024.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$output/Contents/Resources/WolfGrid.icns"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string WolfGrid' "$output/Contents/Info.plist"
if [ -n "${WOLFGRID_PILOT_ENTRY_URL:-}" ]; then
  if [ "${WOLFGRID_PILOT_BUILD:-false}" != true ]; then echo 'A preview entry URL requires a pilot build.'; exit 1; fi
  WOLFGRID_BUNDLE_PLIST="$output/Contents/Info.plist" python3 - <<'PYENTRY'
import os,plistlib,urllib.parse
entry=urllib.parse.urlparse(os.environ['WOLFGRID_PILOT_ENTRY_URL'])
with open(os.environ['WOLFGRID_BUNDLE_PLIST'],'rb') as source: info=plistlib.load(source)
origin=urllib.parse.urlparse(info['WolfGridWebOrigin'])
if (entry.scheme,entry.netloc)!=(origin.scheme,origin.netloc) or entry.path not in ('','/') or entry.username or entry.password: raise SystemExit('Invalid pilot entry origin')
info['WolfGridPilotEntryURL']=os.environ['WOLFGRID_PILOT_ENTRY_URL']
with open(os.environ['WOLFGRID_BUNDLE_PLIST'],'wb') as target: plistlib.dump(info,target)
PYENTRY
fi
identity=${WOLFGRID_SIGNING_IDENTITY:--}
if [ "${WOLFGRID_PUBLIC_RELEASE:-false}" = true ]; then
  case "$identity" in 'Developer ID Application:'*) ;; *) echo 'Public release requires a Developer ID Application identity.'; exit 1;; esac
  if [ -z "${WOLFGRID_NOTARY_PROFILE:-}" ]; then echo 'Public release requires a notary keychain profile.'; exit 1; fi
fi
if [ "$identity" = - ]; then codesign --force --sign - --options runtime --entitlements "$root/WolfGridMac.entitlements" "$output"; else codesign --force --sign "$identity" --options runtime --entitlements "$root/WolfGridMac.entitlements" --timestamp "$output"; fi
codesign --verify --deep --strict "$output"
ditto -c -k --keepParent "$output" "$root/build/WolfGrid-Mac-Preview.zip"
if [ "${WOLFGRID_PUBLIC_RELEASE:-false}" = true ]; then
  xcrun notarytool submit "$root/build/WolfGrid-Mac-Preview.zip" --keychain-profile "$WOLFGRID_NOTARY_PROFILE" --wait
  xcrun stapler staple "$output"
  xcrun stapler validate "$output"
  spctl --assess --type execute "$output"
  ditto -c -k --keepParent "$output" "$root/build/WolfGrid-Mac-Preview.zip"
fi
shasum -a 256 "$root/build/WolfGrid-Mac-Preview.zip" > "$root/build/SHA256SUMS"
echo "$output"
