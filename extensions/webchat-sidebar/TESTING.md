# Chrome Extension Testing Guide

## 🧪 Automated Testing

### Prerequisites

```bash
npm install puppeteer
# or
npm install -g puppeteer
```

### Run Tests

```bash
# Test the built extension
node test_extension.js

# Test specific extension path
node test_extension.js /path/to/extension
```

### What Gets Tested

1. **Extension Loading** - Service worker initialization
2. **Side Panel** - panel.html loads correctly
3. **iframe Loading** - Webchat iframe exists and loads
4. **HTTPS Enforcement** - No insecure HTTP requests (except localhost)
5. **CSP Violations** - Content Security Policy compliance
6. **postMessage** - Communication between panel and iframe
7. **Console Errors** - No critical JavaScript errors
8. **Visual Check** - Screenshot saved to `test-screenshot.png`

### Expected Output

```
📦 Testing extension: SimpleDashboard - AI Analytics Builder v1.0.7

🚀 Starting extension tests...

✓ Extension loaded: chrome-extension://abc123...

🧪 Test 1: Loading side panel...
✓ Iframe exists
✓ Iframe src: https://simpledashboard.wpmix.net?lang=en
✓ Iframe uses HTTPS (or localhost)
✓ No CSP violations
✓ No critical console errors

🧪 Test 5: Testing postMessage...
⚠️  postMessage test timeout (no response from iframe)

📸 Taking screenshot...
✓ Screenshot saved: test-screenshot.png

============================================================
📊 TEST RESULTS
============================================================

⚠️  WARNINGS:
postMessage test timeout (no response from iframe)

✅ All tests PASSED!
   (with warnings)
```

## 🐛 Common Issues

### CSP Violation: HTTP in HTTPS Context

**Error:**
```
Framing 'http://example.com/' violates the following Content Security Policy directive: "frame-src 'self' https://example.com"
```

**Fix:**
- Updated `panel.js` to force HTTPS protocol
- Ensures `iframe.src` uses `https://` (except localhost)

**Code:**
```javascript
if (iframeUrl.protocol === 'http:' && iframeUrl.hostname !== 'localhost') {
  iframeUrl.protocol = 'https:';
}
```

### postMessage Target Origin Mismatch

**Error:**
```
Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('https://example.com') does not match the recipient window's origin ('null').
```

**Causes:**
- iframe hasn't loaded yet (origin is 'null')
- iframe blocked by CSP
- iframe URL redirects to different origin

**Fix:**
- Wait for iframe.onload event
- Ensure CSP allows the iframe origin
- Use `iframe.addEventListener('load', initCommunication)`

## 🔄 CI/CD Integration

### GitHub Actions

Create `.github/workflows/test-extension.yml`:

```yaml
name: Test Chrome Extension

on:
  push:
    paths:
      - 'extensions/webchat-sidebar/**'
  pull_request:
    paths:
      - 'extensions/webchat-sidebar/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install puppeteer

      - name: Build extension
        working-directory: extensions/webchat-sidebar
        run: |
          node build.js \
            --name "Test Extension" \
            --url "https://example.com"

      - name: Run tests
        working-directory: extensions/webchat-sidebar
        run: node test_extension.js

      - name: Upload screenshot
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-screenshot
          path: extensions/webchat-sidebar/test-screenshot.png
```

## 📝 Manual Testing Checklist

Before publishing to Chrome Web Store:

- [ ] Load unpacked extension in Chrome
- [ ] Open side panel (click extension icon)
- [ ] Verify iframe loads without errors
- [ ] Check Chrome DevTools Console (no CSP violations)
- [ ] Test on HTTP and HTTPS sites
- [ ] Test language detection (EN/RU)
- [ ] Test postMessage communication (if applicable)
- [ ] Test on localhost and production URLs
- [ ] Verify all icons display correctly
- [ ] Check extension permissions in manifest

## 🔧 Debug Mode

To see detailed logs, open Chrome DevTools:

1. Right-click on side panel → **Inspect**
2. Go to **Console** tab
3. Look for:
   - CSP violations (red)
   - postMessage logs
   - iframe load events

## 📊 Test Metrics

**Pass Criteria:**
- 0 CSP violations
- 0 critical console errors
- iframe loads successfully
- HTTPS enforced (non-localhost)

**Acceptable Warnings:**
- postMessage timeout (if webchat doesn't respond)
- Network errors for external resources
- Chrome manifest version warnings

## 🚀 Continuous Testing

Run tests automatically:

```bash
# Watch mode (rebuilds + tests on file change)
npm install -g nodemon
nodemon --watch src --exec "node build.js && node test_extension.js"
```

## 🔗 Related Docs

- [Chrome Extension Testing](https://developer.chrome.com/docs/extensions/mv3/tut_debugging/)
- [Puppeteer with Extensions](https://pptr.dev/guides/chrome-extensions)
- [CSP for Extensions](https://developer.chrome.com/docs/extensions/mv3/content_security_policy/)
