# Changelog

## v1.0.3 (2026-02-18)

### 🔐 Google OAuth Support
- **CSP Update**: Added `https://accounts.google.com` and `https://*.google.com` to `frame-src`
- Enables Google Sign In to work within Chrome Extension iframe
- OAuth popups now properly allowed

### 📦 Manifest CSP
```json
"frame-src 'self' https://noxonbot.wpmix.net https://*.wpmix.net https://accounts.google.com https://*.google.com http://localhost:* https://localhost:*;"
```

**Universal OAuth support:**
- ✅ Works in browser (direct access)
- ✅ Works in Chrome Extension (iframe)
- ✅ Single "Web application" OAuth client for both

---

## v1.0.2 (2026-02-18)

### 🔧 Changes
- **CSP Wildcard**: Added `https://*.wpmix.net` to `frame-src` in Content Security Policy
- Now allows loading iframes from **all** wpmix.net subdomains
- Supports future features like in-extension preview panels

### 📦 Manifest CSP
```json
"frame-src 'self' https://noxonbot.wpmix.net https://*.wpmix.net http://localhost:* https://localhost:*;"
```

**Allows:**
- `https://noxonbot.wpmix.net` - main webchat
- `https://*.wpmix.net` - **all subdomains** (d123456, d999999, etc.)
- `http://localhost:*` and `https://localhost:*` - development

---

## v1.0.1 (2026-02-18)

### ✨ Features
- **Auto-preview**: Automatically open preview tab when index.html is created
- **Domain migration**: Changed from `*.habab.ru` to `*.wpmix.net`
- **Dynamic URLs**: Each user gets their own subdomain `https://d{userId}.wpmix.net/`

### 🧪 Testing
- Added automated test suite (19 tests)
- All tests passing

### 🔧 Technical
- Added `notifyExtensionOnFileCreated()` in webchat.ts
- Added `handleFileCreated()` in panel.js
- Added `chrome.runtime.onMessage` listener in background.js
- Trigger words: создан, created, сохран, saved

---

## v1.0.0 (Initial)

### ✨ Features
- Chrome Extension Manifest V3
- Side Panel API integration
- Tab info, page content reading, screenshot capture
- Developer mode with element selection
- iframe embedding of webchat

### 📦 Components
- background.js - Service worker
- panel.js - Side panel logic
- panel.html - Side panel UI
