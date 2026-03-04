#!/bin/bash
# Script to create Google OAuth 2.0 Client ID for noxonbot webchat
# Requires gcloud CLI installed and authenticated

set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT_ID:-noxonbot-production}"
REDIRECT_URI="https://noxonbot.wpmix.net/auth/google/callback"
AUTHORIZED_ORIGIN="https://noxonbot.wpmix.net"
CLIENT_NAME="NoxonBot WebChat OAuth"

echo "🔧 Creating Google OAuth 2.0 Client ID..."
echo "Project: $PROJECT_ID"
echo "Redirect URI: $REDIRECT_URI"
echo "Authorized Origin: $AUTHORIZED_ORIGIN"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI not found"
    echo "Install: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo "❌ Not authenticated with gcloud"
    echo "Run: gcloud auth login"
    exit 1
fi

# Set project
echo "📋 Setting project..."
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo "🔌 Enabling required APIs..."
gcloud services enable iamcredentials.googleapis.com
gcloud services enable cloudresourcemanager.googleapis.com

# Create OAuth consent screen (if not exists)
echo "📝 Configuring OAuth consent screen..."
# Note: This needs to be done via web console for production apps

# Create OAuth 2.0 Client ID using REST API
echo "🔑 Creating OAuth 2.0 Client ID..."

# Get access token
ACCESS_TOKEN=$(gcloud auth print-access-token)

# Create client
RESPONSE=$(curl -s -X POST \
  "https://iamcredentials.googleapis.com/v1/projects/$PROJECT_ID/serviceAccounts:generateAccessToken" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"displayName\": \"$CLIENT_NAME\",
    \"redirectUris\": [\"$REDIRECT_URI\"],
    \"javascriptOrigins\": [\"$AUTHORIZED_ORIGIN\"]
  }")

echo "$RESPONSE"

echo ""
echo "✅ Created! Add to .env:"
echo "GOOGLE_CLIENT_ID=<client_id_from_above>"
