// PW Lecture Downloader - Background Service Worker (Manifest V3)
// This script silently monitors all network requests for PW video URLs.

const PW_URL_PATTERNS = [
  /master\.(m3u8|mpd)(\?|$)/i,
  /\/hls\/\d+\/main\.m3u8/i,
  /\/hls\/main\.m3u8/i,
  /\/dash\//i,
  /(subodhpgcollege|code\.run|streamthorr|streamvideo\.co\.in)/i,
  /(testwave\.cc|bunny-cdn).*(\.m3u8|\.mpd|\/hls\/|\/dash\/)/i,
  /cors\.pwjarvis\.com/i,
  /\/video\/[a-f0-9]+\/\d+p\/video\.mp4/i,
];

// Store detected URLs per tab: { tabId -> { url, timestamp } }
const detectedUrls = {};
let latestDetectedUrl = null;
const detectedPlaylists = {};
let latestDetectedPlaylist = null;

function isStreamUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('blob:')) return false;
  if (/\.(ts|m4s|aac|key|vtt|srt|jpg|jpeg|png|webp|svg|ico|css|woff2?|js|json)(\?|$)/i.test(url)) return false;
  if (url.includes('/enc.key') || url.includes('/get-hls-key')) return false;
  if ((url.includes('testwave.cc') || url.includes('bunny-cdn')) && url.includes('.pdf')) return false;

  if (/\.(m3u8|mpd)(\?|$)/i.test(url)) return true;
  if (/\/hls\/|\/dash\//i.test(url)) return true;
  if (/\/stream\//i.test(url)) return true;
  if (/(subodhpgcollege|code\.run|streamthorr|pwthor|streamvideo\.co\.in|cors\.pwjarvis\.com)/i.test(url)) return true;
  if (/\/video\/[a-f0-9]+\/\d+p\/video\.mp4/i.test(url)) return true;
  if (/(Policy=|Signature=)/i.test(url) && (url.includes('.m3u8') || url.includes('.mpd') || url.includes('/hls/'))) return true;
  return PW_URL_PATTERNS.some(p => p.test(url));
}

function recordUrl(tabId, url) {
  if (!isStreamUrl(url)) return;

  let finalUrl = url;
  if (!url.includes('cors.pwjarvis.com') && !url.includes('.mp4') && !url.includes('testwave.cc') && !url.includes('bunny-cdn')) {
    finalUrl = finalUrl.replace(/\.mpd(\?|$)/gi, '.m3u8$1');
    finalUrl = finalUrl.replace(/\/dash\/.*$/i, '/master.m3u8');
  }

  // If on streamvideo.co.in or Thor stream server, ensure it resolves to /hls/720/main.m3u8
  if (finalUrl.includes('streamvideo.co.in/stream/') && !finalUrl.includes('main.m3u8')) {
    finalUrl = finalUrl.replace(/(https:\/\/[^/]+\/stream\/[^/]+).*/i, '$1/hls/720/main.m3u8');
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
    if (isStreamUrl(details.url)) {
      recordUrl(details.tabId, details.url);
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
    let data = (tabId && tabId > 0) ? detectedUrls[tabId] : null;
    if (!data && latestDetectedUrl) {
      if (since === 0 || latestDetectedUrl.timestamp >= since) {
        data = latestDetectedUrl;
      }
    }
    if (!data) {
      for (const id in detectedUrls) {
        if (detectedUrls[id] && (since === 0 || detectedUrls[id].timestamp >= since)) {
          data = detectedUrls[id];
          break;
        }
      }
    }
    sendResponse({ url: data ? data.url : null, title: data ? data.title : null });
  }

  if (message.type === 'CLEAR_URL') {
    const tabId = message.tabId;
    if (tabId && tabId > 0) {
      delete detectedUrls[tabId];
      delete detectedPlaylists[tabId];
    } else {
      // Clear all cached state if tabId <= 0
      for (const k in detectedUrls) delete detectedUrls[k];
      for (const k in detectedPlaylists) delete detectedPlaylists[k];
    }
    latestDetectedUrl = null;
    latestDetectedPlaylist = null;
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

  function isValidM3U8(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim().replace(/^\uFEFF/, '');
    if (!trimmed.startsWith('#EXTM3U')) return false;
    if (trimmed.includes('function(') || 
        trimmed.includes('var ') || 
        trimmed.includes('const ') || 
        trimmed.includes('let ') || 
        trimmed.includes('module.exports') || 
        trimmed.includes('define.amd') || 
        trimmed.includes('exports=')) {
      return false;
    }
    return trimmed.includes('#EXTINF:') || trimmed.includes('#EXT-X-STREAM-INF') || trimmed.includes('#EXT-X-TARGETDURATION');
  }

  if (message.type === 'SET_PLAYLIST') {
    if (!isValidM3U8(message.playlist)) {
      sendResponse({ success: false });
      return true;
    }
    const tabId = sender.tab?.id || -1;
    const entry = { 
      playlist: message.playlist, 
      url: message.url || null, 
      title: message.title || 'PW_Lecture', 
      timestamp: Date.now() 
    };
    detectedPlaylists[tabId] = entry;
    latestDetectedPlaylist = entry;
    if (tabId > 0) {
      chrome.action.setBadgeText({ text: 'FULL', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId });
    }
    sendResponse({ success: true });
  }

  if (message.type === 'GET_PLAYLIST') {
    const tabId = message.tabId;
    const since = message.since || 0;
    let data = (tabId && tabId > 0) ? detectedPlaylists[tabId] : null;
    if (!data && latestDetectedPlaylist) {
      if (since === 0 || latestDetectedPlaylist.timestamp >= since) {
        data = latestDetectedPlaylist;
      }
    }
    if (!data) {
      for (const id in detectedPlaylists) {
        if (detectedPlaylists[id] && (since === 0 || detectedPlaylists[id].timestamp >= since)) {
          data = detectedPlaylists[id];
          break;
        }
      }
    }
    sendResponse({ 
      playlist: data ? data.playlist : null, 
      url: data ? data.url : null, 
      blobUrl: data ? data.blobUrl : null, 
      title: data ? data.title : null 
    });
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
        regexFilter: "^https?://[^/]*(subodhpgcollege|code\\.run|streamthorr|streamvideo\\.co\\.in)[^/]*/.*",
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
    },
    {
      id: 4,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://vidcloud.eu.org/" },
          { header: "Origin", operation: "set", value: "https://vidcloud.eu.org" }
        ]
      },
      condition: {
        regexFilter: "^https?://[^/]*(testwave\\.cc|bunny-cdn)[^/]*/.*",
        resourceTypes: ["xmlhttprequest", "media", "other"]
      }
    }
  ];

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1, 2, 3, 4],
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

