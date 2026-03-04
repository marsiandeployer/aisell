#!/bin/bash
##
## Get Chrome Web Store OAuth Refresh Token
## Uses out-of-band (oob) method - code shows in browser
##

CLIENT_ID="531979133429-jfdeqa0u3ro24ot2e20drd9sutlaako1.apps.googleusercontent.com"
CLIENT_SECRET="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"

echo "=========================================="
echo "Chrome Web Store OAuth - Get Refresh Token"
echo "=========================================="
echo ""
echo "📋 Step 1: Authorize the application"
echo ""
echo "Open this URL in your browser:"
echo ""
echo "https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=$CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&access_type=offline&prompt=consent"
echo ""
echo "1. Sign in to Google"
echo "2. Allow access"
echo "3. Copy the authorization code shown in browser"
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
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob" \
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
