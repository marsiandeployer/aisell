#!/bin/bash
##
## Get Chrome Web Store OAuth Refresh Token
## Uses localhost callback (Google blocked OOB flow)
##

set -e

CLIENT_ID="531979133429-jfdeqa0u3ro24ot2e20drd9sutlaako1.apps.googleusercontent.com"
CLIENT_SECRET="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"
REDIRECT_URI="http://localhost:8080"
PORT=8080

echo "=========================================="
echo "Chrome Web Store OAuth - Get Refresh Token"
echo "=========================================="
echo ""
echo "📋 Starting local callback server on port $PORT..."

# Temporary file for storing the code
CODE_FILE="/tmp/oauth_code_$$"
rm -f "$CODE_FILE"

# Start local HTTP server in background
python3 -c "
import http.server
import urllib.parse
import sys

class OAuthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if 'code' in params:
            code = params['code'][0]
            with open('$CODE_FILE', 'w') as f:
                f.write(code)

            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            html = '''
            <!DOCTYPE html>
            <html>
            <head><title>OAuth Success</title></head>
            <body style=\"font-family: sans-serif; text-align: center; padding: 100px;\">
                <h1 style=\"color: #22c55e;\">✅ Authorization Successful!</h1>
                <p>You can close this window and return to terminal.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
            </body>
            </html>
            '''
            self.wfile.write(html.encode())

            # Shutdown server after success
            import threading
            threading.Thread(target=self.server.shutdown).start()
        else:
            self.send_response(400)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'Missing code parameter')

    def log_message(self, format, *args):
        pass  # Suppress logs

server = http.server.HTTPServer(('localhost', $PORT), OAuthHandler)
print('✅ Server ready on http://localhost:$PORT', file=sys.stderr)
server.serve_forever()
" 2>&1 &

SERVER_PID=$!

# Wait for server to start
sleep 1

# Build OAuth URL
AUTH_URL="https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&access_type=offline&prompt=consent"

echo ""
echo "=========================================="
echo "📋 Step 1: Authorize the application"
echo "=========================================="
echo ""
echo "Open this URL in your browser:"
echo ""
echo "$AUTH_URL"
echo ""
echo "Or run this command on your local machine:"
echo "  xdg-open '$AUTH_URL'"
echo ""
echo "Waiting for authorization..."

# Wait for code file to appear (timeout 5 minutes)
TIMEOUT=300
ELAPSED=0
while [ ! -f "$CODE_FILE" ] && [ $ELAPSED -lt $TIMEOUT ]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
done

# Kill server if still running
kill $SERVER_PID 2>/dev/null || true

if [ ! -f "$CODE_FILE" ]; then
    echo "❌ Timeout waiting for authorization"
    exit 1
fi

AUTH_CODE=$(cat "$CODE_FILE")
rm -f "$CODE_FILE"

if [ -z "$AUTH_CODE" ]; then
    echo "❌ No code received"
    exit 1
fi

echo ""
echo "✅ Authorization code received!"
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
