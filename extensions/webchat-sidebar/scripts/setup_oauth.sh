#!/bin/bash
##
## Chrome Web Store OAuth Setup (Manual)
## Google blocked OOB flow, so we use web redirect + manual code copy
##

set -e

CLIENT_ID="531979133429-uisb4r6j4u34d0v27igb4bhclkbbbhvf.apps.googleusercontent.com"
CLIENT_SECRET="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"
REDIRECT_URI="https://noxonbot.wpmix.net/oauth/callback"

echo "=========================================="
echo "Chrome Web Store OAuth Setup"
echo "=========================================="
echo ""
echo "📋 Step 1: Open this URL in browser:"
echo ""
echo "https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&access_type=offline&prompt=consent"
echo ""
echo "=========================================="
echo "📋 Step 2: After authorization"
echo "=========================================="
echo ""
echo "Google will redirect you to:"
echo "  https://noxonbot.wpmix.net/oauth/callback?code=XXXXX..."
echo ""
echo "⚠️  IMPORTANT: The page will redirect to homepage."
echo "   You need to COPY THE CODE from address bar QUICKLY!"
echo ""
echo "Alternative: Check browser history for URL starting with:"
echo "  https://noxonbot.wpmix.net/oauth/callback?code="
echo ""
echo "=========================================="
echo "📋 Step 3: Paste the authorization code"
echo "=========================================="
echo ""
read -p "Enter authorization code (after code= in URL): " AUTH_CODE

if [ -z "$AUTH_CODE" ]; then
    echo "❌ No code provided"
    exit 1
fi

# Remove any trailing parameters (like &scope=...)
AUTH_CODE=$(echo "$AUTH_CODE" | cut -d'&' -f1)

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
    echo ""
    echo "Response:"
    echo "$TOKEN_RESPONSE" | jq '.'
    echo ""
    echo "💡 Common issues:"
    echo "  - Code expired (try again, copy faster)"
    echo "  - Code already used (get new code)"
    echo "  - Wrong redirect_uri in Google Console"
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
