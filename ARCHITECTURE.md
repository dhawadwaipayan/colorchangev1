# Architecture Documentation

## Purpose

Add a reliable "Copy deep link" control in Gmail that produces RFC822 Message-ID-based URLs, which are stable across recipients and accounts.

## System Components

### 1. Content Script (`content.js`)

**Role:** Observes Gmail DOM and injects UI elements

**Key Functions:**
- `startObserver()` - Sets up MutationObserver for Gmail's SPA
- `scanConversationView()` - Finds message bubbles with `[data-legacy-message-id]`
- `scanThreadListView()` - Finds thread rows with `[data-legacy-thread-id]`
- `ensureButton()` - Injects "⧉ Copy link" button if not already present
- `showToast()` - Displays temporary notification

**DOM Selectors:**
- `[data-legacy-message-id]` - Gmail's internal message ID on conversation bubbles
- `[data-legacy-thread-id]` - Gmail's internal thread ID on list view rows
- `.gH` - Message header bar in conversation view
- `span.bog` - Subject line in thread list view

**Selector Strategy:**
Gmail's DOM is built as a Single Page Application (SPA) that updates dynamically. The selectors used (`data-legacy-*`) have been stable for years and are less likely to change than class names or structure. If selectors fail, buttons simply won't render - the extension fails gracefully without breaking Gmail.

### 2. Service Worker (`service-worker.js`)

**Role:** OAuth token management and Gmail API integration

**Key Functions:**
- `getToken()` - Obtains OAuth token via Chrome Identity API
- `authedGetJson()` - Makes authenticated Gmail API calls with 401 retry
- `getMessageIdHeaderByMessage()` - Fetches Message-ID for a specific message
- `getMessageIdHeaderForLastInThread()` - Fetches Message-ID for last message in thread
- `normalizeMessageId()` - Strips angle brackets from Message-ID
- `buildDeepLink()` - Constructs URL-escaped deep link

**Caching:**
- In-memory Map with 2-minute TTL
- Cache keys: `msg:{gmailMessageId}` and `thread-last:{threadId}`
- Reduces API calls for repeated requests

**Error Handling:**
- Non-interactive token request first, falls back to interactive
- 401 errors trigger token invalidation and retry
- All errors propagated to content script as `{ ok: false, error: string }`

### 3. Options Page (`options.html`)

**Role:** User preferences

**Settings:**
- Enable/disable buttons in conversation view
- Enable/disable buttons in thread list view
- Stored in `chrome.storage.sync`

*(Note: Current implementation doesn't enforce these settings in content.js - future enhancement)*

## Data Flow

```
User clicks "⧉ Copy link"
    ↓
content.js: ensureButton() callback triggered
    ↓
chrome.runtime.sendMessage({ type: "getDeepLinkForMessage", gmailMessageId })
    ↓
service-worker.js: onMessage listener receives request
    ↓
Check cache for Message-ID
    ↓
If not cached: Gmail API call
  GET https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}?format=metadata&metadataHeaders=Message-ID
    ↓
Extract "Message-ID" header from response
    ↓
Strip angle brackets: "<abc@x.com>" → "abc@x.com"
    ↓
Build deep link: https://mail.google.com/mail/#search/rfc822msgid%3A{encoded}
    ↓
Cache result (2 min TTL)
    ↓
sendResponse({ ok: true, url })
    ↓
content.js: receives response
    ↓
navigator.clipboard.writeText(url)
    ↓
showToast("Deep link copied")
```

## Link Structure

### Format
```
https://mail.google.com/mail/#search/rfc822msgid%3A<URL-encoded-Message-ID>
```

### Why RFC822 Message-ID?

- **Universal:** Message-ID is standard across email systems (RFC 822/5322)
- **Stable:** Doesn't change when forwarding, archiving, or across accounts
- **Unique:** Guaranteed unique identifier for each message
- **Portable:** Works for any user with access to the message

### Why No `/u/0`?

Gmail uses `/u/N` for account index in multi-account setups. Omitting it makes links work regardless of:
- Which account index the user has
- Whether they've switched accounts
- Whether they're using single or multi-account mode

## Permissions

### Required Permissions

| Permission | Purpose |
|------------|---------|
| `identity` | OAuth 2.0 authentication with Google |
| `storage` | Save user preferences (options page) |
| `scripting` | Inject content script into Gmail |
| `activeTab` | Access active tab for script injection |
| `https://mail.google.com/*` | Host permission for Gmail DOM access |
| `https://gmail.googleapis.com/*` | Host permission for Gmail API calls |

### OAuth Scopes

- `https://www.googleapis.com/auth/gmail.readonly` - Read-only access to Gmail

## Security & Privacy

### Security Measures

1. **Content Security Policy:** Strict CSP prevents code injection
   ```json
   "script-src 'self'; object-src 'none'; base-uri 'none';"
   ```

2. **No external scripts:** All code bundled with extension

3. **Minimal scope:** Only `gmail.readonly` - cannot send, delete, or modify emails

4. **Token handling:** Chrome Identity API manages tokens securely

### Privacy Considerations

1. **No data collection:** Extension doesn't send data anywhere except Gmail API
2. **No persistent storage:** Headers cached in memory only (2 min TTL)
3. **Local processing:** All URL building happens in service worker
4. **No tracking:** No analytics, telemetry, or user behavior monitoring

### Threat Model

**What this protects against:**
- Malicious external scripts
- Data exfiltration
- Unauthorized email access beyond reading
- XSS attacks via CSP

**What this doesn't protect against:**
- User granting extension to malicious actor
- Compromised Google account
- Gmail API outages
- Browser/extension platform vulnerabilities

## OAuth Setup

### Google Cloud Console Steps

1. Create project
2. Enable Gmail API
3. Create OAuth 2.0 Client ID
4. Set application type: Chrome Extension
5. Configure authorized redirect URI:
   ```
   https://<EXTENSION_ID>.chromiumapp.org/
   ```
6. Copy Client ID to `manifest.json`

### First-Time Authorization Flow

1. User clicks button
2. Service worker requests token non-interactively → fails (no token yet)
3. Requests interactively → Chrome shows OAuth consent screen
4. User approves → token cached by Chrome Identity API
5. Future requests use cached token (non-interactive)

## Performance

### Optimization Strategies

1. **Single MutationObserver:** One observer for entire Gmail DOM
2. **Cheap scans:** Query only for specific data attributes
3. **Short cache TTL:** Balance API calls vs. stale data
4. **No polling:** Event-driven architecture
5. **Lazy injection:** Buttons created only when needed

### Performance Characteristics

- **Initial page load:** ~10-50ms for first scan
- **SPA navigation:** ~5-20ms for incremental scans
- **Button click:** ~100-500ms (OAuth + API + clipboard)
- **Memory:** ~1-2MB for extension + cache

## Error Handling & Fallbacks

### Graceful Degradation

| Failure | Behavior |
|---------|----------|
| OAuth fails | Toast shows error, user can retry |
| API call fails | Error propagated to UI, shows toast |
| Clipboard access denied | Toast shows error |
| DOM selector not found | Button not injected, no visible error |
| Message-ID missing | Error toast shown |
| Network offline | API call fails, error shown |

### Debugging

**Service Worker Console:**
```javascript
chrome://extensions → "service worker" link
```

**Content Script Console:**
```javascript
Open Gmail → DevTools (F12) → Console tab
```

**Common Issues:**
- **401 Unauthorized:** Client ID mismatch or API not enabled
- **Buttons not appearing:** DOM selectors changed or page not fully loaded
- **"Unknown error":** Check service worker console for details

## Limitations

### Known Constraints

1. **Gmail web only:** Doesn't work in mobile apps or other email clients
2. **Requires Message-ID header:** Rare messages without it will fail
3. **Requires read access:** Respects Gmail's permission model
4. **DOM dependency:** Subject to Gmail UI changes
5. **Chrome/Chromium only:** Manifest V3, Chrome Identity API

### Future Improvements

1. **Enforce options settings:** Check `chrome.storage.sync` before injecting buttons
2. **Keyboard shortcuts:** Add hotkey for current message
3. **Omnibox command:** Type command to copy link for open message
4. **Better error messages:** Specific guidance for each error type
5. **Batch operations:** Copy links for multiple selected messages
6. **Alternative selectors:** Fallback strategies if primary selectors fail

## Testing Strategy

### Manual Testing Checklist

- [ ] Load extension in Chrome
- [ ] Authorize OAuth (first time)
- [ ] Test conversation view buttons
- [ ] Test thread list view buttons
- [ ] Verify clipboard has correct URL
- [ ] Paste URL in new tab, verify it opens correct message
- [ ] Test with multiple accounts
- [ ] Test in different Gmail views (inbox, sent, search results)
- [ ] Test error cases (revoke OAuth, disable API)

### Automated Testing (Future)

Potential Playwright tests:
1. Button injection in mock Gmail DOM
2. Clipboard copy with mock API responses
3. OAuth flow simulation
4. Error handling scenarios

## Standards & Best Practices

### JSDoc

All functions documented with:
- Description
- `@param` for each parameter with type
- `@returns` with return type
- Error conditions noted

### Code Style

- ES6+ syntax
- Async/await for promises
- Arrow functions for callbacks
- Single responsibility functions
- Descriptive variable names

### Manifest V3 Compliance

- Service worker instead of background page
- `chrome.identity` for OAuth
- No remote code execution
- Strict CSP
- Host permissions instead of broad permissions

## References

- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/identity/)
- [RFC 5322 (Message-ID)](https://tools.ietf.org/html/rfc5322#section-3.6.4)
- [Gmail Search Operators](https://support.google.com/mail/answer/7190)
