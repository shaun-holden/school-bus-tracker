#!/bin/sh

# Xcode Cloud post-clone script for the Capacitor iOS app.
#
# Xcode Cloud checks out the repo fresh: no node_modules, no built web bundle
# (dist/ is gitignored), and no CocoaPods Pods/ dir. The archive then fails on
# the missing `Pods-App/Pods-App.release.xcconfig`. This regenerates all of it:
#   1. Node + CocoaPods toolchain (the Podfile references ../../node_modules/@capacitor/*)
#   2. the web bundle the app serves (Phase B: served locally from capacitor://localhost)
#   3. cap sync — copies the bundle into ios/App and runs `pod install`, which
#      recreates the xcconfig files the archive needs.
#
# Xcode Cloud runs this automatically after cloning, before xcodebuild.
# It must live in a `ci_scripts` folder beside the Xcode project (ios/App) and
# be named exactly ci_post_clone.sh.

set -e

# Homebrew is preinstalled on Xcode Cloud runners; add the toolchain we need.
brew install node
brew install cocoapods

# This script runs from ios/App/ci_scripts; move to the repository root.
cd "$CI_PRIMARY_REPOSITORY_PATH"

# Install JS deps, build the web bundle, and sync it into the iOS project.
# `cap sync ios` copies dist/public into the app and runs `pod install`,
# regenerating the Pods target-support xcconfig files.
npm ci
npm run build
npx cap sync ios
