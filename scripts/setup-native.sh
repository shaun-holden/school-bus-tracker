#!/bin/bash

# School Bus Tracker — Native App Setup Script
# Run this locally (Mac required for iOS, Mac or PC for Android)

set -e

echo "======================================"
echo "  School Bus Tracker - Native Setup"
echo "======================================"
echo ""

# Check required tools
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is required. Install from https://nodejs.org"
  exit 1
fi

if ! command -v npx &> /dev/null; then
  echo "ERROR: npx is required. Install Node.js from https://nodejs.org"
  exit 1
fi

echo "Step 1: Installing dependencies..."
npm install

echo ""
echo "Step 2: Building the web app..."
npm run build

echo ""
echo "Step 3: Setting up native platforms..."

# Add iOS (Mac only)
if [[ "$OSTYPE" == "darwin"* ]]; then
  if [ ! -d "ios" ]; then
    echo "  Adding iOS platform..."
    npx cap add ios
  else
    echo "  iOS platform already exists, syncing..."
  fi
  echo "  Syncing web assets to iOS..."
  npx cap sync ios
  echo ""
  echo "  iOS setup complete!"
  echo "  Run: npx cap open ios   (opens Xcode)"
else
  echo "  Skipping iOS — macOS required for iOS builds"
fi

# Add Android (any OS)
if [ ! -d "android" ]; then
  echo "  Adding Android platform..."
  npx cap add android
else
  echo "  Android platform already exists, syncing..."
fi
echo "  Syncing web assets to Android..."
npx cap sync android

echo ""
echo "======================================"
echo "  Setup complete!"
echo "======================================"
echo ""
echo "To open in Android Studio:"
echo "  npx cap open android"
echo ""
if [[ "$OSTYPE" == "darwin"* ]]; then
echo "To open in Xcode (iOS):"
echo "  npx cap open ios"
echo ""
fi
echo "After any code change, run:"
echo "  npm run build && npx cap sync"
echo ""
