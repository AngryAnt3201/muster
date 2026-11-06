#!/bin/sh
# App Store builds for Muster.
#   sh tools/ios-release.sh dry      Release build for the simulator, unsigned. Proves the Release config compiles. Never talks to Apple.
#   sh tools/ios-release.sh archive  Release archive for devices, signed by Xcode's automatic signing (team in app.config.json).
#   sh tools/ios-release.sh export   App Store .ipa from that archive, using ios/App/ExportOptions.plist.
# archive and export pass -allowProvisioningUpdates so Xcode can register the bundle id and create the
# distribution certificate and profile with the Apple account signed in under Xcode > Settings > Accounts.
# That talks to Apple, so they are for Jack to run in his own terminal; they refuse inside an agent shell.
set -eu
cd "$(dirname "$0")/.."

PROJECT=ios/App/App.xcodeproj
ARCHIVE=ios/App/build/Muster.xcarchive
EXPORT_DIR=ios/App/build/export

prepare() {
  node tools/release-config.mjs "$@"
  npm run build
  npx cap sync ios
}

jack_only() {
  if [ -n "${CLAUDECODE:-}" ] && [ -z "${MUSTER_RELEASE_BY_JACK:-}" ]; then
    echo "ios-release: '$1' signs with Apple's servers. Run it in your own terminal (agents must not)." >&2
    exit 2
  fi
}

case "${1:-}" in
  dry)
    prepare --warn-copy
    xcodebuild -project "$PROJECT" -scheme App -configuration Release \
      -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath ios/App/build/dd-release \
      CODE_SIGNING_ALLOWED=NO build
    APP=ios/App/build/dd-release/Build/Products/Release-iphonesimulator/App.app
    echo "--- Release dry run OK: $APP"
    /usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' -c 'Print :CFBundleShortVersionString' -c 'Print :CFBundleVersion' -c 'Print :CFBundleIdentifier' "$APP/Info.plist"
    ;;
  archive)
    jack_only archive
    prepare
    rm -rf "$ARCHIVE"
    xcodebuild -project "$PROJECT" -scheme App -configuration Release \
      -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
      -allowProvisioningUpdates archive
    echo "--- Archive: $ARCHIVE (also visible in Xcode > Window > Organizer)"
    ;;
  export)
    jack_only export
    [ -d "$ARCHIVE" ] || { echo "No archive at $ARCHIVE. Run: npm run ios:release" >&2; exit 1; }
    rm -rf "$EXPORT_DIR"
    xcodebuild -exportArchive -archivePath "$ARCHIVE" \
      -exportOptionsPlist ios/App/ExportOptions.plist -exportPath "$EXPORT_DIR" \
      -allowProvisioningUpdates
    echo "--- IPA: $(ls "$EXPORT_DIR"/*.ipa)"
    ;;
  *)
    echo "usage: sh tools/ios-release.sh dry|archive|export" >&2
    exit 1
    ;;
esac
