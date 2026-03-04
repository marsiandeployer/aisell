#!/usr/bin/env python3
"""
E2E Test: User Registration -> Subdomain Creation -> SSL Verification

Проверяет:
1. Регистрация нового пользователя через webchat
2. Создание поддомена d{userId}.wpmix.net
3. Валидность SSL сертификата для поддомена
"""

import asyncio
import json
import os
import random
import re
import requests
import ssl
import socket
import subprocess
import sys
import time
from pathlib import Path

# Configuration
WEBCHAT_URL = os.getenv('WEBCHAT_URL', 'https://noxonbot.wpmix.net')
REVERSE_PROXY_HOST = '109.172.101.40'

def generate_test_email():
    """Generate unique test email"""
    timestamp = int(time.time())
    random_id = random.randint(1000, 9999)
    return f"test+{timestamp}{random_id}@example.com"

def register_user(email, name="Test User"):
    """Register new user via /api/auth/claim endpoint"""
    print(f"📧 Registering user: {email}")

    # Send auth claim request
    response = requests.post(
        f"{WEBCHAT_URL}/api/auth/claim",
        json={"email": email, "name": name, "startParam": ""},
        timeout=30
    )

    if response.status_code != 200:
        print(f"❌ Registration failed: {response.status_code} {response.text}")
        return None

    data = response.json()
    user_info = data.get('user', {})
    user_id = user_info.get('userId')

    if not user_id:
        print(f"❌ Invalid response: {data}")
        return None

    # Extract sessionId from cookies
    cookies = response.cookies
    session_id = cookies.get('sessionId', 'unknown')

    print(f"✅ User ID confirmed: {user_id}")
    print(f"✅ Session ID: {session_id}")
    return {"userId": user_id, "sessionId": session_id, "email": email}

def wait_for_ssl_cert(domain, max_wait=600):
    """Wait for SSL certificate to be generated and deployed"""
    print(f"⏳ Waiting for SSL certificate for {domain}...")
    start_time = time.time()
    
    while time.time() - start_time < max_wait:
        try:
            # Check if cert exists on reverse proxy
            result = subprocess.run(
                ['ssh', f'root@{REVERSE_PROXY_HOST}',
                 f'certbot certificates 2>/dev/null | grep -q "Domains:.*{domain}" && echo "exists" || echo "missing"'],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if 'exists' in result.stdout:
                print(f"✅ Certificate exists for {domain}")
                return True
            
            print(f"⏳ Certificate not ready yet, waiting... ({int(time.time() - start_time)}s)")
            time.sleep(10)
            
        except Exception as e:
            print(f"⚠️  Error checking certificate: {e}")
            time.sleep(10)
    
    print(f"❌ Timeout waiting for certificate ({max_wait}s)")
    return False

def verify_ssl_certificate(domain):
    """Verify SSL certificate is valid for the domain"""
    print(f"🔒 Verifying SSL certificate for {domain}...")
    
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                subject = dict(x[0] for x in cert['subject'])
                issued_to = subject.get('commonName', '')
                
                print(f"📜 Certificate issued to: {issued_to}")
                
                if issued_to != domain:
                    print(f"❌ Certificate mismatch: expected {domain}, got {issued_to}")
                    return False
                
                # Check if certificate is valid
                if cert:
                    print(f"✅ SSL certificate valid for {domain}")
                    return True
                else:
                    print(f"❌ No certificate found")
                    return False
                    
    except ssl.SSLError as e:
        print(f"❌ SSL Error: {e}")
        return False
    except Exception as e:
        print(f"❌ Connection Error: {e}")
        return False

def test_placeholder_page(domain):
    """Test that placeholder page loads correctly"""
    print(f"📄 Testing placeholder page at https://{domain}/...")
    
    try:
        response = requests.get(f"https://{domain}/", timeout=10, verify=True)
        
        if response.status_code != 200:
            print(f"❌ HTTP {response.status_code}")
            return False
        
        if "Your Website Will Be Here" not in response.text:
            print(f"❌ Placeholder text not found in response")
            return False
        
        print(f"✅ Placeholder page loads correctly")
        return True
        
    except Exception as e:
        print(f"❌ Error loading page: {e}")
        return False

def trigger_ssl_generation(user_id):
    """Trigger SSL generation script on reverse proxy"""
    print(f"🔧 Triggering SSL generation for user {user_id}...")
    
    try:
        result = subprocess.run(
            ['ssh', f'root@{REVERSE_PROXY_HOST}',
             '/root/auto-ssl-for-user-domains-wpmix.sh'],
            capture_output=True,
            text=True,
            timeout=300
        )
        
        print(f"📝 Script output:\n{result.stdout}")
        
        if result.returncode != 0:
            print(f"⚠️  Script exited with code {result.returncode}")
            print(f"Error output:\n{result.stderr}")
        else:
            print(f"✅ SSL generation script completed")
        
        return result.returncode == 0
        
    except Exception as e:
        print(f"❌ Error running SSL generation script: {e}")
        return False

def main():
    print("="*60)
    print("🧪 E2E Test: User Registration -> Subdomain SSL")
    print("="*60)
    
    # Step 1: Register new user
    email = generate_test_email()
    user = register_user(email, "E2E Test User")
    
    if not user:
        print("\n❌ Test FAILED: User registration failed")
        sys.exit(1)
    
    user_id = user['userId']
    domain = f"d{user_id}.wpmix.net"
    
    print(f"\n📌 Test domain: {domain}")
    
    # Step 2: Trigger SSL generation
    if not trigger_ssl_generation(user_id):
        print("\n⚠️  SSL generation script had issues, but continuing...")
    
    # Step 3: Wait for SSL certificate
    if not wait_for_ssl_cert(domain, max_wait=600):
        print("\n❌ Test FAILED: SSL certificate not generated")
        sys.exit(1)
    
    # Step 4: Verify SSL certificate
    if not verify_ssl_certificate(domain):
        print("\n❌ Test FAILED: SSL certificate invalid")
        sys.exit(1)
    
    # Step 5: Test placeholder page loads
    if not test_placeholder_page(domain):
        print("\n❌ Test FAILED: Placeholder page doesn't load")
        sys.exit(1)
    
    print("\n"+"="*60)
    print("✅ Test PASSED: All checks successful!")
    print(f"🌐 Test domain: https://{domain}/")
    print(f"👤 User ID: {user_id}")
    print(f"📧 Email: {email}")
    print("="*60)

if __name__ == '__main__':
    main()
