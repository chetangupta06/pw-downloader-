// PW Lecture Downloader - Content Script
// Runs on every page as a secondary interception layer.
// Patches XMLHttpRequest and fetch to catch video URLs that
// the webRequest API might miss (e.g., requests inside iframes).

(function () {
  const PW_PATTERNS = [
    /sec-prod-mediacdn\.pw\.live\/[^?]+master\.m3u8/i,
    /sec-prod-mediacdn\.pw\.live\/[^?]+master\.mpd/i,
    /sec-prod-mediacdn\.pw\.live\/[^?]+\/hls\/\d+\/main\.m3u8/i,
    /cdn\.penpencil\.co\/.*master\.m3u8/i,
    /cdn\.penpencil\.co\/.*master\.mpd/i,
    /cloudfront\.net\/.*master\.m3u8/i,
    /cloudfront\.net\/.*master\.mpd/i,
    /testwave\.cc\/.*master\.m3u8/i,
    /testwave\.cc\/.*master\.mpd/i,
  ];

  function checkAndReport(url) {
    if (!url || typeof url !== 'string') return;
    if (PW_PATTERNS.some((p) => p.test(url))) {
      chrome.runtime.sendMessage({ type: 'SET_URL', url }, () => {
        // Ignore errors (e.g., background not ready)
        if (chrome.runtime.lastError) {}
      });
    }
  }

  // --- Patch fetch ---
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    checkAndReport(url);
    return originalFetch.apply(this, args);
  };

  // --- Patch XMLHttpRequest ---
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    checkAndReport(url);
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  // --- Scan DOM for <video> and <source> tags ---
  function scanDOM() {
    document.querySelectorAll('video[src], source[src]').forEach((el) => {
      checkAndReport(el.src);
    });
  }

  // Scan on load and on DOM mutations
  document.addEventListener('DOMContentLoaded', scanDOM);
  const observer = new MutationObserver(scanDOM);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
