# Gmail Deep Link Copier

A Chrome extension that adds "⧉ Copy link" buttons in Gmail to copy deep links to specific messages using their RFC822 Message-ID.

## What it does

- **Injects buttons in Gmail** on mail.google.com in two places:
  - Next to each message bubble in conversation view
  - Next to each thread row in list view
- **Creates stable deep links** using Gmail's `#search/rfc822msgid:` URL format
- **Works across accounts** - links don't include `/u/0` so they work regardless of account index
- **Uses Gmail API** to fetch Message-ID headers via OAuth (read-only access)

## Installation

### 1. Set up OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Gmail API**
4. Go to **Credentials** → Create **OAuth 2.0 Client ID**
5. Choose **Chrome Extension** as application type
6. Set **Authorized redirect URI** to:
   ```
   https://<YOUR_EXTENSION_ID>.chromiumapp.org/
   ```
   (You'll get the extension ID after loading it in Chrome - see step 2.5)
7. Copy the **Client ID**

### 2. Install the extension

1. Clone this repository
2. Open `manifest.json` and replace `__REPLACE_WITH_OAUTH_CLIENT_ID__` with your OAuth Client ID
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (toggle in top right)
5. Click **Load unpacked** and select this folder
6. Copy the **Extension ID** from the card
7. Go back to Google Cloud Console → Credentials and update the redirect URI with your actual extension ID
8. Reload the extension in Chrome

### 3. Test it

1. Open [Gmail](https://mail.google.com)
2. You should see "⧉ Copy link" buttons next to messages and threads
3. Click a button - you'll be prompted to authorize the extension (first time only)
4. After authorization, click again to copy the deep link
5. Paste the link in a new tab - it should open the exact message

## How it works

### Link format

Deep links use Gmail's RFC822 Message-ID search:
```
https://mail.google.com/mail/#search/rfc822msgid%3A<message-id>
```

Example:
```
https://mail.google.com/mail/#search/rfc822msgid%3ACAH%3Dj8u4kZ...%40mail.gmail.com
```

### Architecture

- **content.js** - Observes Gmail DOM and injects buttons
- **service-worker.js** - Handles OAuth and Gmail API calls
- **Message flow:**
  1. User clicks "⧉ Copy link" button
  2. Content script sends message to service worker with Gmail message/thread ID
  3. Service worker fetches Message-ID header via Gmail API
  4. Service worker builds and returns deep link URL
  5. Content script copies to clipboard and shows toast

### Permissions

- `identity` - OAuth authentication
- `storage` - Save user preferences
- `scripting`, `activeTab` - Inject content script
- `mail.google.com` - Access Gmail DOM
- `gmail.googleapis.com` - Fetch message headers

## Configuration

Right-click the extension icon → **Options** to toggle:
- Enable buttons in conversation view
- Enable buttons in thread list view

## Development

### File structure

```
gmail-deeplinker/
├── manifest.json         # Extension configuration
├── service-worker.js     # Background script (OAuth, API calls)
├── content.js           # Content script (DOM injection)
├── content.css          # Button and toast styles
├── options.html         # Settings page
├── logo/               # Extension icons
├── README.md           # This file
└── ARCHITECTURE.md     # Detailed architecture docs
```

### Debugging

**Service worker:**
- Go to `chrome://extensions`
- Click "service worker" link under the extension
- Console opens with service worker logs

**Content script:**
- Open Gmail
- Open DevTools (F12)
- Check Console for content script logs
- Use "Inspect element" on buttons

**OAuth issues:**
- Check Client ID in manifest.json
- Verify redirect URI matches extension ID
- Check Gmail API is enabled in Cloud Console

## Limitations

- Requires read access to the message (respects Gmail permissions)
- Messages without Message-ID header will fail (rare)
- Gmail DOM selectors may change - uses stable `[data-legacy-*-id]` attributes
- Only works in Gmail web UI (not mobile apps)

## Privacy & Security

- **No external scripts** - all code runs locally
- **Read-only access** - only requests `gmail.readonly` scope
- **No data collection** - headers cached briefly in memory only
- **CSP enforced** - strict Content Security Policy prevents code injection
- **Minimal permissions** - only what's needed for core functionality

## Credits

Based on [Chrome Extension v3 Starter](https://github.com/SimGus/chrome-extension-v3-starter) by SimGus.

## License

See LICENSE file.
