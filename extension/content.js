// PW Lecture Downloader - Content Script
// Runs in ISOLATED world, injects inject.js into MAIN world safely without CSP violation.

// 1. Safe, CSP-compliant injection of inject.js using extension URL
try {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
} catch (e) {
  // Ignored
}

// 2. Isolated world message listener (receives detected video URLs from inject.js in MAIN world)
window.addEventListener('message', function (event) {
  if (event.source !== window || !event.data || event.data.type !== 'PW_URL_DETECTED') return;

  chrome.runtime.sendMessage({ type: 'SET_URL', url: event.data.url, title: event.data.title }, () => {
    if (chrome.runtime.lastError) {}
  });
});

// 3. Fallback DOM Scanner for standard HTML5 video elements
const PW_FALLBACK_PATTERNS = [
  /master\.(m3u8|mpd)/i,
  /\/hls\/(\d+\/)?main\.m3u8/i,
  /(subodhpgcollege|code\.run|streamthorr|pwthor)/i,
  /sec-prod-mediacdn\.pw\.live/i,
  /cloudfront\.net/i,
  /testwave\.cc/i,
];

function checkFallback(url) {
  if (!url || typeof url !== 'string' || url.startsWith('blob:')) return;
  if (PW_FALLBACK_PATTERNS.some((p) => p.test(url))) {
    chrome.runtime.sendMessage({ type: 'SET_URL', url, title: document.title }, () => {
      if (chrome.runtime.lastError) {}
    });
  }
}

function scanDOM() {
  document.querySelectorAll('video[src], source[src]').forEach((el) => checkFallback(el.src));
  document.querySelectorAll('input[type="hidden"]').forEach((el) => {
    if (el.value && (el.value.includes('.m3u8') || el.value.includes('.mpd'))) {
      checkFallback(el.value);
    }
  });
}

document.addEventListener('DOMContentLoaded', scanDOM);
const observer = new MutationObserver(scanDOM);
observer.observe(document.documentElement, { childList: true, subtree: true });
