#!/bin/bash
##
## Setup Chrome Web Store OAuth using existing Google Cloud project (mycity2-1033)
##
## This script helps you create OAuth 2.0 credentials and get refresh token
## using your existing Google Cloud project from /root/mycity2_key.json
##

set -e

PROJECT_ID="mycity2-1033"
SERVICE_ACCOUNT_EMAIL="amogtb-allcdoaces@mycity2-1033.iam.gserviceaccount.com"
REDIRECT_URI="https://noxonbot.wpmix.net/oauth/callback"

echo "=========================================="
echo "Chrome Web Store OAuth Setup"
echo "=========================================="
echo "Using existing project: $PROJECT_ID"
echo "Redirect URI: $REDIRECT_URI"
echo ""

echo "📋 STEP 1: Enable Chrome Web Store API"
echo "----------------------------------------"
echo "Open in browser:"
echo "https://console.cloud.google.com/apis/library/chromewebstore.googleapis.com?project=$PROJECT_ID"
echo ""
echo "Click 'Enable' button"
echo ""
read -p "Press Enter when done..."

echo ""
echo "📋 STEP 2: Create OAuth 2.0 Client ID"
echo "----------------------------------------"
echo "Open in browser:"
echo "https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo ""
echo "1. Click 'Create Credentials' → 'OAuth client ID'"
echo "2. Application type: 'Web application'"
echo "3. Name: 'Chrome Web Store Publisher'"
echo "4. Authorized redirect URIs: $REDIRECT_URI"
echo "5. Click 'Create'"
echo "6. Download JSON file or copy Client ID and Client Secret"
echo ""
read -p "Press Enter when done..."

echo ""
echo "📋 STEP 3: Enter your OAuth credentials"
echo "----------------------------------------"
read -p "Client ID: " CLIENT_ID
read -p "Client Secret: " CLIENT_SECRET

echo ""
echo "📋 STEP 4: Get Refresh Token"
echo "----------------------------------------"
echo ""
echo "⚠️  IMPORTANT: OAuth callback endpoint must be running!"
echo "Start it in another terminal:"
echo ""
echo "  cd /root/aisell/extensions/webchat-sidebar"
echo "  node scripts/oauth_callback_server.js"
echo ""
read -p "Press Enter when callback server is running..."

echo ""
echo "Open this URL in your browser:"
echo ""
echo "https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=$CLIENT_ID&redirect_uri=$(echo $REDIRECT_URI | jq -sRr @uri)&access_type=offline&prompt=consent"
echo ""
echo "1. Authorize the app"
echo "2. You'll be redirected to $REDIRECT_URI?code=..."
echo "3. Copy the 'code' parameter from URL"
echo ""
read -p "Enter authorization code: " AUTH_CODE

# Exchange code for refresh token
echo ""
echo "🔑 Getting refresh token..."

TOKEN_RESPONSE=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "code=$AUTH_CODE" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "redirect_uri=$REDIRECT_URI" \
  -d "grant_type=authorization_code")

REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refresh_token // empty')

if [ -z "$REFRESH_TOKEN" ]; then
    echo "❌ Failed to get refresh token!"
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi

echo "✅ Got refresh token!"

# Save to .env
ENV_FILE="/root/aisell/extensions/webchat-sidebar/.env"

echo ""
echo "💾 Saving credentials to .env..."
cat > "$ENV_FILE" << EOF
# Chrome Web Store API credentials
# Project: $PROJECT_ID
CHROME_STORE_CLIENT_ID="$CLIENT_ID"
CHROME_STORE_CLIENT_SECRET="$CLIENT_SECRET"
CHROME_STORE_REFRESH_TOKEN="$REFRESH_TOKEN"
EOF

chmod 600 "$ENV_FILE"

echo "✅ Saved to: $ENV_FILE"
echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "You can now publish to Chrome Web Store:"
echo ""
echo "  cd /root/aisell/extensions/webchat-sidebar"
echo "  source .env"
echo "  ./scripts/publish-to-chrome-store.sh"
echo ""
