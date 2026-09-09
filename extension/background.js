// PW Lecture Downloader - Background Service Worker (Manifest V3)
// This script silently monitors all network requests for PW video URLs.

const PW_URL_PATTERNS = [
  /master\.m3u8(\?|$)/i,
  /master\.mpd(\?|$)/i,
  /\/hls\/\d+\/main\.m3u8/i,
  /\/dash\//i,
  /(subodhpgcollege|code\.run|streamthorr)/i,
  /cors\.pwjarvis\.com/i,
  /\/video\/[a-f0-9]+\/\d+p\/video\.mp4/i,
];

// Store detected URLs per tab: { tabId -> { url, timestamp } }
const detectedUrls = {};
let latestDetectedUrl = null;

function recordUrl(tabId, url) {
  const isMasterUrl =
    url.includes('master.m3u8') ||
    url.includes('master.mpd') ||
    url.includes('/dash/') ||
    url.includes('subodhpgcollege') ||
    url.includes('code.run') ||
    url.includes('cors.pwjarvis.com') ||
    url.includes('/video.mp4') ||
    /\/hls\/\d+\/main\.m3u8/.test(url);

  if (!isMasterUrl) return;

  let finalUrl = url;
  if (!url.includes('cors.pwjarvis.com') && !url.includes('.mp4')) {
    finalUrl = finalUrl.replace(/\.mpd(\?|$)/gi, '.m3u8$1');
    finalUrl = finalUrl.replace(/\/dash\/.*$/i, '/master.m3u8');
    finalUrl = finalUrl.replace(
      /(https:\/\/[^/]+\/[a-fA-F0-9\-]+)\/hls\/\d+\/main\.m3u8/,
      '$1/hls/720/main.m3u8'
    );
  }

  const entry = { url: finalUrl, title: 'PW_Lecture', timestamp: Date.now() };
  latestDetectedUrl = entry;

  if (tabId && tabId > 0) {
    detectedUrls[tabId] = entry;
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab && tab.title) {
        entry.title = tab.title.replace(/(\s*-\s*Physics Wallah\s*|\s*\|\s*Physics Wallah\s*)/gi, '').trim() || 'PW_Lecture';
      }
    });

    chrome.action.setBadgeText({ text: '1', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
  }

  console.log(`[PW Downloader] Detected video URL (tab ${tabId}): ${finalUrl}`);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const isVideoUrl = PW_URL_PATTERNS.some((pattern) => pattern.test(url));
    if (isVideoUrl) {
      recordUrl(details.tabId, url);
    }
  },
  { urls: ['<all_urls>'] },
  []
);

// Capture student PW Bearer token when active on PW
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.requestHeaders) {
      const auth = details.requestHeaders.find(h => h.name.toLowerCase() === 'authorization');
      if (auth && auth.value && auth.value.startsWith('Bearer ')) {
        chrome.storage.local.set({ pw_token: auth.value });
      }
    }
  },
  { urls: ['*://*.penpencil.co/*', '*://*.pw.live/*'] },
  ['requestHeaders']
);

// Listen for messages from popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_URL') {
    const tabId = message.tabId;
    const since = message.since || 0;
    let data = detectedUrls[tabId];
    if (!data && latestDetectedUrl && latestDetectedUrl.timestamp >= since) {
      data = latestDetectedUrl;
    }
    sendResponse({ url: data ? data.url : null, title: data ? data.title : null });
  }

  if (message.type === 'CLEAR_URL') {
    const tabId = message.tabId;
    delete detectedUrls[tabId];
    latestDetectedUrl = null;
    if (tabId && tabId > 0) {
      chrome.action.setBadgeText({ text: '', tabId });
      chrome.action.setTitle({ title: 'PW Lecture Downloader', tabId });
    }
    sendResponse({ success: true });
  }

  if (message.type === 'SET_URL') {
    // Called from content.js when it intercepts a URL via page-level hooks
    recordUrl(sender.tab?.id || -1, message.url);
    sendResponse({ success: true });
  }

  return true; // Keep the message channel open for async
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete detectedUrls[tabId];
});

// Setup Declarative Net Request rules to inject Origin and Referer for stream servers (bypasses Cloudflare 403)
async function setupStreamHeaderRules() {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) return;

  const rules = [
    {
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://pwthor.live/" },
          { header: "Origin", operation: "set", value: "https://pwthor.live" }
        ]
      },
      condition: {
        regexFilter: "^https?://[^/]*(subodhpgcollege|code\\.run|streamthorr)[^/]*/.*",
        resourceTypes: ["xmlhttprequest", "media", "other"]
      }
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://vidcloud.eu.org/" },
          { header: "Origin", operation: "set", value: "https://vidcloud.eu.org" }
        ]
      },
      condition: {
        regexFilter: "^https?://[^/]*(vidcloud)[^/]*/.*",
        resourceTypes: ["xmlhttprequest", "media", "other"]
      }
    },
    {
      id: 3,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://www.pwjarvis.com/" },
          { header: "Origin", operation: "set", value: "https://www.pwjarvis.com" }
        ]
      },
      condition: {
        regexFilter: "^https?://[^/]*(cors\\.pwjarvis\\.com)[^/]*/.*",
        resourceTypes: ["xmlhttprequest", "media", "other"]
      }
    }
  ];

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1, 2, 3],
      addRules: rules
    });
    console.log("[PW Downloader] Stream header rules active.");
  } catch (e) {
    console.warn("[PW Downloader] Failed to update dynamic DNR rules:", e);
  }
}

chrome.runtime.onInstalled.addListener(setupStreamHeaderRules);
chrome.runtime.onStartup.addListener(setupStreamHeaderRules);
setupStreamHeaderRules();

