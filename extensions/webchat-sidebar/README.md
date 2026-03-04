# Chrome Extension Builder for WebChat Sidebar

Universal builder for creating Chrome Extensions that embed webchat in browser sidebar.

## 🚀 Quick Start

### Build Extension

```bash
node build.js \
  --name "SimpleDashboard - AI Analytics Builder" \
  --short-name "SimpleDashboard" \
  --url "https://simpledashboard.wpmix.net" \
  --description "Build business dashboards with AI"
```

**Output:**
- `out/webchat-sidebar/` - unpacked extension
- `out/webchat-sidebar.zip` - packaged for Chrome Web Store

### Test Extension

```bash
# Install Puppeteer (first time only)
npm install puppeteer

# Run automated tests
node test_extension.js
```

**Tests include:**
- CSP violation detection
- HTTPS enforcement
- iframe loading
- postMessage communication
- Console error checking
- Visual screenshot

See [TESTING.md](./TESTING.md) for detailed testing guide.

## 📦 Build Parameters

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `--name` | Yes | Full extension name | "SimpleDashboard - AI Analytics Builder" |
| `--short-name` | No | Short name (12 chars max) | "SimpleDashboard" |
| `--url` | Yes | Webchat URL (HTTPS) | "https://simpledashboard.wpmix.net" |
| `--description` | No | Extension description | "Build dashboards with AI" |
| `--version` | No | Version (auto-increments) | "1.0.7" |

## 🔧 Fixed Issues

### v1.0.10 - Safe Iframe Bootstrap

**Problem:** In some builds, iframe could attempt HTTP navigation before JS normalization, triggering:
```
Framing 'http://...'
Failed to execute 'postMessage' ... recipient window's origin ('null')
```

**Solution:**
- `panel.html` now boots iframe with `about:blank` and keeps real URL in `data-webchat-url`
- `panel.js` normalizes URL first (`http -> https` except localhost), then sets `iframe.src`
- `postMessage` send is now guarded with `try/catch` to avoid noisy errors when frame is blocked

### v1.0.7 - HTTPS Enforcement

**Problem:** Extension loaded HTTP URLs causing CSP violations:
```
Framing 'http://simpledashboard.wpmix.net/' violates CSP directive
```

**Solution:** Auto-upgrade HTTP to HTTPS in `panel.js`:
```javascript
if (iframeUrl.protocol === 'http:' && iframeUrl.hostname !== 'localhost') {
  iframeUrl.protocol = 'https:';
}
```

## 🏭 Product Build Commands

Ready-to-use commands for each product:

### SimpleDashboard
```bash
node build.js \
  --name "SimpleDashboard" \
  --short-name "SimpleDashboard" \
  --url "https://simpledashboard.wpmix.net" \
  --description "Build business dashboards with AI"
```
Download: `https://simpledashboard.wpmix.net/downloads/chrome-sidebar-extension.zip`

### Noxon (RU)
```bash
node build.js \
  --name "Noxon Sidebar" \
  --short-name "Noxon" \
  --url "https://clodeboxbot.habab.ru"
```
Download: `https://clodeboxbot.habab.ru/downloads/chrome-sidebar-extension.zip`

### Coderbox (EN)
```bash
node build.js \
  --name "Coderbox Sidebar" \
  --short-name "Coderbox" \
  --url "https://coderbox.wpmix.net"
```
Download: `https://coderbox.wpmix.net/downloads/chrome-sidebar-extension.zip`

> **Important:** Always pass `--short-name` explicitly. Default is "Codebox" which is wrong for other products.

## 📁 Project Structure

```
extensions/webchat-sidebar/
├── build.js                    # Main builder script
├── src/
│   ├── background.js           # Service worker template
│   ├── panel.html              # Side panel HTML template
│   ├── panel.js                # Side panel JS
│   ├── panel_shared.js         # Shared panel utilities
│   ├── ethereum-provider.js    # Web3 wallet (injected into d*.wpmix.net)
│   ├── content-script-ethereum.js  # Content script for Ethereum bridge
│   ├── ethers.min.js           # Ethers.js library
│   ├── eth-request-handler.js  # Ethereum RPC request handler
│   ├── keypair-handlers.js     # Keypair generation/storage
│   ├── icons/                  # Extension icons (16/32/48/128/1024 px)
│   └── onboarding-screenshots/ # Screenshots shown in extension onboarding
│       ├── construction-crm.png
│       ├── funnel-analytics.png
│       └── sales-utm.png
├── store_assets/               # Chrome Web Store materials (NOT in extension ZIP)
│   ├── screenshots/            # Store listing screenshots (1280x800)
│   └── previews/               # Promo images
├── chrome-store-materials/     # Legacy store materials
├── previews/                   # Landing page preview cases
│   ├── cases/                  # Interactive demo cases
│   ├── landing-pages/          # Landing page templates
│   └── templates/              # HTML templates
├── out/                        # Build output (gitignored)
│   ├── webchat-sidebar/        # Unpacked extension
│   └── webchat-sidebar.zip     # Packaged ZIP
└── tests/                      # Test files
```

### What goes INTO the extension ZIP:
- `manifest.json`, `background.js`, `panel.html`, `panel.js`, `panel_shared.js`
- `icons/` (16/32/48/128 px)
- `onboarding-screenshots/` (shown inside extension)
- Web3 files: `ethereum-provider.js`, `content-script-ethereum.js`, `ethers.min.js`, `eth-request-handler.js`, `keypair-handlers.js`

### What stays OUT of extension ZIP:
- `store_assets/` — uploaded separately to Chrome Web Store
- `chrome-store-materials/` — legacy store assets
- `previews/` — used by webchat landing page, served by Express

## 📚 Documentation

- [TESTING.md](./TESTING.md) - Automated testing guide
- [CHROME_STORE_SETUP.md](./CHROME_STORE_SETUP.md) - Chrome Web Store publishing
- [EXTENSION_API.md](./EXTENSION_API.md) - Extension postMessage API
- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/mv3/)
