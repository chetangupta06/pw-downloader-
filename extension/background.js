// PW Lecture Downloader - Background Service Worker (Manifest V3)
// This script silently monitors all network requests for PW video URLs.

const PW_URL_PATTERNS = [
  /sec-prod-mediacdn\.pw\.live\/[^/]+\/master\.m3u8/i,
  /sec-prod-mediacdn\.pw\.live\/[^/]+\/hls\/\d+\/main\.m3u8/i,
  /sec-prod-mediacdn\.pw\.live\/[^/]+\/master\.mpd/i,
  /cdn\.penpencil\.co\/.*master\.m3u8/i,
  /cdn\.penpencil\.co\/.*master\.mpd/i,
  /cloudfront\.net\/.*master\.m3u8/i,
  /cloudfront\.net\/.*master\.mpd/i,
  /testwave\.cc\/.*master\.m3u8/i,
  /testwave\.cc\/.*master\.mpd/i,
];

// Store detected URLs per tab: { tabId -> { url, timestamp } }
const detectedUrls = {};

// Listen to all web requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const tabId = details.tabId;

    if (tabId < 0) return; // Ignore background requests

    const isVideoUrl = PW_URL_PATTERNS.some((pattern) => pattern.test(url));

    if (isVideoUrl) {
      // Only store the master/root URL, not quality-specific ones
      const isMasterUrl =
        url.includes('master.m3u8') ||
        url.includes('master.mpd') ||
        /\/hls\/\d+\/main\.m3u8/.test(url);

      if (!isMasterUrl) return;

      const existing = detectedUrls[tabId];
      // Don't overwrite with same URL
      if (existing && existing.url === url) return;

      detectedUrls[tabId] = { url, timestamp: Date.now() };

      // Convert .mpd to .m3u8 automatically
      let finalUrl = url.replace(/\.mpd(\?|$)/gi, '.m3u8$1');
      // Normalize /hls/720/main.m3u8 → master URL
      finalUrl = finalUrl.replace(
        /(https:\/\/[^/]+\/[a-fA-F0-9\-]+)\/hls\/\d+\/main\.m3u8/,
        '$1/hls/720/main.m3u8'
      );

      detectedUrls[tabId] = { url: finalUrl, timestamp: Date.now() };

      // Update badge to alert user
      chrome.action.setBadgeText({ text: '1', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
      chrome.action.setTitle({
        title: 'PW video detected! Click to download.',
        tabId,
      });

      console.log(`[PW Downloader] Detected video URL on tab ${tabId}: ${finalUrl}`);
    }
  },
  { urls: ['<all_urls>'] },
  []
);

// Listen for messages from popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_URL') {
    const tabId = message.tabId;
    const data = detectedUrls[tabId];
    sendResponse({ url: data ? data.url : null });
  }

  if (message.type === 'CLEAR_URL') {
    const tabId = message.tabId;
    delete detectedUrls[tabId];
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.action.setTitle({ title: 'PW Lecture Downloader', tabId });
    sendResponse({ success: true });
  }

  if (message.type === 'SET_URL') {
    // Called from content.js when it intercepts a URL via page-level hooks
    const tabId = sender.tab?.id;
    if (tabId && tabId > 0) {
      const existing = detectedUrls[tabId];
      if (!existing) {
        let finalUrl = message.url.replace(/\.mpd(\?|$)/gi, '.m3u8$1');
        detectedUrls[tabId] = { url: finalUrl, timestamp: Date.now() };
        chrome.action.setBadgeText({ text: '1', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
        chrome.action.setTitle({
          title: 'PW video detected! Click to download.',
          tabId,
        });
      }
    }
    sendResponse({ success: true });
  }

  return true; // Keep the message channel open for async
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete detectedUrls[tabId];
});
