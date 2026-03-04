#!/usr/bin/env python3
"""
Create Google OAuth 2.0 Client ID for NoxonBot WebChat
Uses service account credentials to create a web application OAuth client
"""

import json
import sys
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Service account key path
SERVICE_ACCOUNT_KEY = '/root/mycity2_key.json'
PROJECT_ID = 'mycity2-1033'

# OAuth Client configuration
CLIENT_NAME = 'noxonbot-webchat-oauth'
AUTHORIZED_ORIGINS = ['https://noxonbot.wpmix.net']
REDIRECT_URIS = [
    'https://noxonbot.wpmix.net/auth/google/callback',
    'http://localhost:8091/auth/google/callback'  # For local development
]

def create_oauth_client():
    try:
        # Load service account credentials
        credentials = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_KEY,
            scopes=['https://www.googleapis.com/auth/cloud-platform']
        )

        # Build the IAM service
        service = build('iam', 'v1', credentials=credentials)

        print(f"✅ Authenticated with service account")
        print(f"📋 Project: {PROJECT_ID}")
        print(f"🌐 Authorized origins: {AUTHORIZED_ORIGINS}")
        print(f"🔄 Redirect URIs: {REDIRECT_URIS}")
        print("")

        # Note: Creating OAuth clients via API requires Admin SDK
        # which service accounts don't have access to by default
        print("⚠️  OAuth Client creation via API requires manual setup")
        print("")
        print("🔧 Alternative: Use gcloud CLI")
        print("")
        print("Manual steps:")
        print("1. Open: https://console.cloud.google.com/apis/credentials?project=" + PROJECT_ID)
        print("2. Click 'Create Credentials' → 'OAuth client ID'")
        print("3. Application type: Web application")
        print("4. Name: " + CLIENT_NAME)
        print("5. Authorized JavaScript origins:")
        for origin in AUTHORIZED_ORIGINS:
            print(f"   - {origin}")
        print("6. Authorized redirect URIs:")
        for uri in REDIRECT_URIS:
            print(f"   - {uri}")
        print("")
        print("7. Copy the Client ID and run:")
        print("   export GOOGLE_CLIENT_ID='your-client-id-here'")
        print("   sed -i 's/GOOGLE_CLIENT_ID=.*/GOOGLE_CLIENT_ID='\"$GOOGLE_CLIENT_ID\"'/' /root/aisell/noxonbot/.env")
        print("   pm2 restart noxonbot-webchat")

        return None

    except HttpError as error:
        print(f'❌ API Error: {error}')
        return None
    except Exception as error:
        print(f'❌ Error: {error}')
        return None

if __name__ == '__main__':
    create_oauth_client()
