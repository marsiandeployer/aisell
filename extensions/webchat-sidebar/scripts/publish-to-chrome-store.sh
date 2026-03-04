#!/bin/bash
##
## Auto-publish NoxonBot extension to Chrome Web Store
##
## Required:
## - Chrome Web Store API credentials (client_id, client_secret, refresh_token)
## - App ID from Chrome Web Store
##
## Usage:
##   ./scripts/publish-to-chrome-store.sh
##

set -e

# Chrome Web Store App ID
APP_ID="hhdhmbcogahhehapnagdibghiedpnckn"

# Extension directory
EXT_DIR="/root/aisell/extensions/webchat-sidebar"
ZIP_FILE="$EXT_DIR/out/webchat-sidebar.zip"

# Load .env file if exists
ENV_FILE="$EXT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

# OAuth credentials (store in .env or pass as environment variables)
# Get these from: https://console.cloud.google.com/apis/credentials
CLIENT_ID="${CHROME_STORE_CLIENT_ID}"
CLIENT_SECRET="${CHROME_STORE_CLIENT_SECRET}"
REFRESH_TOKEN="${CHROME_STORE_REFRESH_TOKEN}"

# Check if zip exists
if [ ! -f "$ZIP_FILE" ]; then
    echo "❌ Extension zip not found: $ZIP_FILE"
    echo "Run: cd $EXT_DIR && node build.js"
    exit 1
fi

echo "========================================"
echo "Chrome Web Store Auto-Publisher"
echo "========================================"
echo "App ID: $APP_ID"
echo "Zip: $ZIP_FILE"
echo ""

# Check credentials
if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ] || [ -z "$REFRESH_TOKEN" ]; then
    echo "❌ Missing OAuth credentials!"
    echo ""
    echo "Set these environment variables:"
    echo "  export CHROME_STORE_CLIENT_ID=..."
    echo "  export CHROME_STORE_CLIENT_SECRET=..."
    echo "  export CHROME_STORE_REFRESH_TOKEN=..."
    echo ""
    echo "Or store them in $EXT_DIR/.env"
    echo ""
    echo "📖 Setup guide: https://developer.chrome.com/docs/webstore/using_webstore_api/"
    exit 1
fi

# Step 1: Get access token
echo "🔑 Getting access token..."
ACCESS_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
    -d "client_id=$CLIENT_ID" \
    -d "client_secret=$CLIENT_SECRET" \
    -d "refresh_token=$REFRESH_TOKEN" \
    -d "grant_type=refresh_token" | jq -r '.access_token')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" == "null" ]; then
    echo "❌ Failed to get access token"
    exit 1
fi

echo "✅ Access token obtained"

# Step 2: Upload new version
echo ""
echo "📦 Uploading new version..."
UPLOAD_RESPONSE=$(curl -s -X PUT \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-api-version: 2" \
    -T "$ZIP_FILE" \
    "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$APP_ID")

# Check for errors
UPLOAD_STATUS=$(echo "$UPLOAD_RESPONSE" | jq -r '.uploadState // .error.message // "unknown"')

if [[ "$UPLOAD_STATUS" == *"SUCCESS"* ]] || [[ "$UPLOAD_STATUS" == *"IN_PROGRESS"* ]]; then
    echo "✅ Upload successful"
else
    echo "❌ Upload failed: $UPLOAD_STATUS"
    echo "$UPLOAD_RESPONSE" | jq '.'
    exit 1
fi

# Step 3: Publish
echo ""
echo "🚀 Publishing to Chrome Web Store..."
PUBLISH_RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-api-version: 2" \
    -H "Content-Length: 0" \
    "https://www.googleapis.com/chromewebstore/v1.1/items/$APP_ID/publish")

PUBLISH_STATUS=$(echo "$PUBLISH_RESPONSE" | jq -r '.status[0] // .error.message // "unknown"')

if [[ "$PUBLISH_STATUS" == *"OK"* ]] || [[ "$PUBLISH_STATUS" == *"PUBLISHED"* ]]; then
    echo "✅ Published successfully!"
else
    echo "⚠️ Publish status: $PUBLISH_STATUS"
    echo "$PUBLISH_RESPONSE" | jq '.'
fi

echo ""
echo "========================================"
echo "✅ Done!"
echo "========================================"
echo ""
echo "View your extension:"
echo "https://chrome.google.com/webstore/detail/$APP_ID"
echo ""
echo "Developer console:"
echo "https://chrome.google.com/webstore/devconsole"
