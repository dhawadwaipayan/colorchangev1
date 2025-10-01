/* eslint-disable no-console */
/**
 * Background service worker: token management, Gmail API calls, deep link building.
 * All functions are documented with JSDoc for clarity and future maintenance.
 */

// Cache tokens and headers briefly to reduce API calls.
const headerCache = new Map(); // key: gmailMessageId or threadId+last; val: { header: string, ts: number }
const CACHE_TTL_MS = 2 * 60 * 1000;

/**
 * Get an OAuth token for the requested scopes using chrome.identity.
 * Always requests non-interactively first; falls back to interactive on demand.
 * @param {boolean} interactive Whether to show the account chooser/consent if needed.
 * @returns {Promise<string>} Bearer token.
 */
async function getToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, token => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No token"));
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * Fetch JSON with automatic token injection and 401 retry (token invalidation).
 * @param {string} url REST endpoint URL.
 * @returns {Promise<any>} Parsed JSON.
 */
async function authedGetJson(url) {
  let token = await getToken(false).catch(() => null);
  if (!token) token = await getToken(true);
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    // Invalidate and retry once interactively.
    await new Promise(r => chrome.identity.getAuthToken({ interactive: false }, t => t && chrome.identity.removeCachedAuthToken({ token: t }, r)));
    token = await getToken(true);
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Extract a single header value by name from a Gmail API Message resource.
 * @param {any} message Gmail API message JSON (format=metadata).
 * @param {string} name Header name, e.g., "Message-ID".
 * @returns {string|null} Header value or null if absent.
 */
function getHeader(message, name) {
  const headers = message?.payload?.headers || [];
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

/**
 * Normalize RFC822 Message-ID by stripping angle brackets if present.
 * @param {string} raw Raw header value, e.g., "<abc@x.com>".
 * @returns {string} Normalized value without <>.
 */
function normalizeMessageId(raw) {
  return raw.replace(/^<|>$/g, "");
}

/**
 * Build a Gmail rfc822msgid deep link for a given Message-ID (without angle brackets).
 * No user index (/u/0) is included for universality.
 * @param {string} normalizedMessageId Message-ID without angle brackets.
 * @returns {string} Fully URL-escaped Gmail deep link.
 */
function buildDeepLink(normalizedMessageId) {
  return `https://mail.google.com/mail/#search/rfc822msgid%3A${encodeURIComponent(normalizedMessageId)}`;
}

/**
 * Get RFC822 Message-ID for a Gmail message by its Gmail messageId.
 * Uses metadata format to keep payload small.
 * @param {string} gmailMessageId Gmail message resource ID.
 * @returns {Promise<string>} Normalized Message-ID.
 */
async function getMessageIdHeaderByMessage(gmailMessageId) {
  const cacheKey = `msg:${gmailMessageId}`;
  const now = Date.now();
  const cached = headerCache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.header;
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailMessageId)}?format=metadata&metadataHeaders=Message-ID`;
  const message = await authedGetJson(url);
  const raw = getHeader(message, "Message-ID");
  if (!raw) throw new Error("Message-ID header not found");
  const normalized = normalizeMessageId(raw);
  headerCache.set(cacheKey, { header: normalized, ts: now });
  return normalized;
}

/**
 * Get RFC822 Message-ID for the last message in a thread.
 * @param {string} threadId Gmail thread ID.
 * @returns {Promise<string>} Normalized Message-ID of last message in thread.
 */
async function getMessageIdHeaderForLastInThread(threadId) {
  const cacheKey = `thread-last:${threadId}`;
  const now = Date.now();
  const cached = headerCache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.header;
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Message-ID`;
  const thread = await authedGetJson(url);
  const last = thread.messages?.[thread.messages.length - 1];
  if (!last) throw new Error("Thread has no messages");
  const raw = getHeader(last, "Message-ID");
  if (!raw) throw new Error("Message-ID header not found");
  const normalized = normalizeMessageId(raw);
  headerCache.set(cacheKey, { header: normalized, ts: now });
  return normalized;
}

// Message router for content script requests.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "getDeepLinkForMessage") {
        const normalized = await getMessageIdHeaderByMessage(msg.gmailMessageId);
        sendResponse({ ok: true, url: buildDeepLink(normalized) });
      } else if (msg?.type === "getDeepLinkForThreadLast") {
        const normalized = await getMessageIdHeaderForLastInThread(msg.threadId);
        sendResponse({ ok: true, url: buildDeepLink(normalized) });
      } else {
        sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
