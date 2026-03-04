#!/bin/bash
# Quick setup verification script
# Проверяет что все компоненты на месте

echo "🔍 Quick Setup Check"
echo "===================="
echo ""

# Check 1: Extension files exist
echo "📦 Extension files:"
if [ -f "src/background.js" ]; then echo "  ✅ background.js"; else echo "  ❌ background.js MISSING"; fi
if [ -f "src/panel.js" ]; then echo "  ✅ panel.js"; else echo "  ❌ panel.js MISSING"; fi
if [ -f "src/panel.html" ]; then echo "  ✅ panel.html"; else echo "  ❌ panel.html MISSING"; fi
if [ -f "out/webchat-sidebar.zip" ]; then echo "  ✅ out/webchat-sidebar.zip"; else echo "  ❌ ZIP MISSING"; fi
echo ""

# Check 2: Auto-preview feature in background.js
echo "🔧 Auto-preview feature:"
if grep -q "open_preview" src/background.js; then
  echo "  ✅ background.js has open_preview listener"
else
  echo "  ❌ background.js MISSING open_preview"
fi

if grep -q "handleFileCreated" src/panel.js; then
  echo "  ✅ panel.js has handleFileCreated function"
else
  echo "  ❌ panel.js MISSING handleFileCreated"
fi
echo ""

# Check 3: Webchat integration
echo "🌐 Webchat integration:"
if [ -f "/root/aisell/noxonbot/src/webchat.ts" ]; then
  if grep -q "notifyExtensionOnFileCreated" /root/aisell/noxonbot/src/webchat.ts; then
    echo "  ✅ webchat.ts has notifyExtensionOnFileCreated"
  else
    echo "  ❌ webchat.ts MISSING notifyExtensionOnFileCreated"
  fi

  if grep -q "wpmix.net" /root/aisell/noxonbot/src/webchat.ts; then
    echo "  ✅ webchat.ts uses wpmix.net domain"
  else
    echo "  ❌ webchat.ts NOT using wpmix.net"
  fi

  if grep -q "habab.ru" /root/aisell/noxonbot/src/webchat.ts; then
    echo "  ⚠️  WARNING: Found old habab.ru domain"
  else
    echo "  ✅ No old habab.ru references"
  fi
else
  echo "  ❌ webchat.ts NOT FOUND"
fi
echo ""

# Check 4: PM2 service
echo "🚀 PM2 service:"
if pm2 list | grep -q "noxonbot-webchat"; then
  if pm2 list | grep "noxonbot-webchat" | grep -q "online"; then
    echo "  ✅ noxonbot-webchat is running"
  else
    echo "  ⚠️  noxonbot-webchat exists but NOT online"
  fi
else
  echo "  ❌ noxonbot-webchat NOT found in pm2"
fi
echo ""

# Check 5: Test file
echo "🧪 Automated test:"
if [ -f "test-auto-preview.js" ]; then
  echo "  ✅ test-auto-preview.js exists"
  echo "  Run: node test-auto-preview.js"
else
  echo "  ❌ test-auto-preview.js MISSING"
fi
echo ""

# Check 6: Build script
echo "🔨 Build script:"
if [ -f "build.js" ]; then
  echo "  ✅ build.js exists"
  echo "  Run: node build.js --name=\"Codebox\" --url=\"https://noxonbot.wpmix.net\""
else
  echo "  ❌ build.js MISSING"
fi
echo ""

echo "===================="
echo "Setup check complete!"
echo ""
echo "Next steps:"
echo "1. Run tests: node test-auto-preview.js"
echo "2. Check PM2: pm2 logs noxonbot-webchat --lines 20"
echo "3. Load extension in Chrome: chrome://extensions"
echo "4. Manual test: Ask Claude to create index.html"
