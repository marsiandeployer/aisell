#!/bin/bash
##
## Get Chrome Web Store OAuth Refresh Token
## Uses web OAuth flow with https://noxonbot.wpmix.net/oauth/callback
##

set -e

CLIENT_ID="531979133429-uisb4r6j4u34d0v27igb4bhclkbbbhvf.apps.googleusercontent.com"
CLIENT_SECRET="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"
REDIRECT_URI="https://noxonbot.wpmix.net/oauth/callback"

echo "=========================================="
echo "Chrome Web Store OAuth - Get Refresh Token"
echo "=========================================="
echo ""
echo "📋 Step 1: Start callback server"
echo ""

# Check if oauth_callback_server.js is running
if ! pm2 list | grep -q oauth_callback_server; then
    echo "Starting OAuth callback server..."
    cd /root/aisell/extensions/webchat-sidebar
    pm2 start scripts/oauth_callback_server.js --name oauth_callback_server
    pm2 save
    sleep 2
else
    echo "✅ OAuth callback server already running"
fi

echo ""
echo "=========================================="
echo "📋 Step 2: Authorize the application"
echo "=========================================="
echo ""
echo "Open this URL in your browser:"
echo ""
echo "https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&access_type=offline&prompt=consent"
echo ""
echo "After authorization, you'll be redirected to:"
echo "$REDIRECT_URI"
echo ""
echo "Copy the authorization code and paste it below."
echo ""
read -p "Enter authorization code: " AUTH_CODE

if [ -z "$AUTH_CODE" ]; then
    echo "❌ No code provided"
    exit 1
fi

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
    echo "Response:"
    echo "$TOKEN_RESPONSE" | jq '.'
    exit 1
fi

echo "✅ Got refresh token!"

# Update .env
ENV_FILE="/root/aisell/extensions/webchat-sidebar/.env"

cat > "$ENV_FILE" << EOF
# Chrome Web Store API credentials
# Project: mycity2-1033
CHROME_STORE_CLIENT_ID="$CLIENT_ID"
CHROME_STORE_CLIENT_SECRET="$CLIENT_SECRET"
CHROME_STORE_REFRESH_TOKEN="$REFRESH_TOKEN"
EOF

chmod 600 "$ENV_FILE"

echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "Credentials saved to: $ENV_FILE"
echo ""
echo "You can now publish to Chrome Web Store:"
echo ""
echo "  cd /root/aisell/extensions/webchat-sidebar"
echo "  ./scripts/publish-to-chrome-store.sh"
echo ""
echo "Stop OAuth callback server:"
echo "  pm2 stop oauth_callback_server"
echo ""
