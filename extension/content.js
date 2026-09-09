// PW Lecture Downloader - Content Script
// Runs on every page as a secondary interception layer.
// Patches XMLHttpRequest and fetch to catch video URLs that
// the webRequest API might miss (e.g., requests inside iframes).

(function () {
  const PW_PATTERNS = [
    /master\.m3u8(\?|$)/i,
    /master\.mpd(\?|$)/i,
    /\/hls\/\d+\/main\.m3u8/i,
    /\/dash\//i,
    /(subodhpgcollege|code\.run|streamthorr)/i,
    /cors\.pwjarvis\.com/i,
    /\/video\/[a-f0-9]+\/\d+p\/video\.mp4/i,
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
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
    checkAndReport(url);
    
    try {
        const response = await originalFetch.apply(this, args);
        const clonedResponse = response.clone();
        
        clonedResponse.text().then(text => {
            if (typeof text === 'string' && text.startsWith('#EXTM3U')) {
                if (!url.includes('enc.key') && (text.includes('#EXT-X-STREAM-INF') || text.includes('#EXTINF:'))) {
                    chrome.runtime.sendMessage({ type: 'SET_URL', url: response.url || url }, () => {
                        if (chrome.runtime.lastError) {}
                    });
                }
            }
        }).catch(() => {});
        
        return response;
    } catch (e) {
        return Promise.reject(e);
    }
  };

  // --- Patch XMLHttpRequest ---
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    checkAndReport(url);
    
    // Attach event listener to check the response content for obfuscated M3U8 playlists
    this.addEventListener('load', function() {
        try {
            const responseText = this.responseText;
            // If the response is an HLS playlist (even if the URL is completely obfuscated)
            if (typeof responseText === 'string' && responseText.startsWith('#EXTM3U')) {
                // Ensure we don't accidentally intercept small media playlists if we already got a master
                if (!url.includes('enc.key') && responseText.includes('#EXT-X-STREAM-INF')) {
                    chrome.runtime.sendMessage({ type: 'SET_URL', url: this.responseURL || url }, () => {
                        if (chrome.runtime.lastError) {}
                    });
                } else if (!url.includes('enc.key') && responseText.includes('#EXTINF:')) {
                    // Fallback for direct media playlists without a master
                    chrome.runtime.sendMessage({ type: 'SET_URL', url: this.responseURL || url }, () => {
                        if (chrome.runtime.lastError) {}
                    });
                }
            }
        } catch(e) {
            // Ignore response reading errors (e.g., binary data or CORS)
        }
    });

    return originalXhrOpen.call(this, method, url, ...rest);
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

  // --- Auto clicker for Android/Windows popup and video autoplay ---
  function initAutoClicker() {
    const allowedDomains = ['vidcloud.eu.org', 'rarestudy.in', 'samfygros.com', 'pwthor.live', 'pwjarvis.com'];
    if (!allowedDomains.some(d => window.location.hostname.includes(d))) return;
    
    const clickerInterval = setInterval(() => {
      // 1. Click Android / Windows button
      const elements = document.querySelectorAll('span, div, button, p, h1, h2, h3, h4');
      for (let el of elements) {
        if (el.textContent && el.textContent.includes('Android / Windows') && el.children.length === 0) {
          el.click();
          if (el.parentElement) el.parentElement.click();
          if (el.parentElement?.parentElement) el.parentElement.parentElement.click();
        }
      }

      // 2. Mute and play video elements
      document.querySelectorAll('video').forEach((v) => {
        if (v.src) checkAndReport(v.src);
        v.querySelectorAll('source').forEach(s => { if (s.src) checkAndReport(s.src); });
        try {
          v.muted = true;
          v.play();
        } catch (e) {}
      });

      // 3. Click play buttons
      document.querySelectorAll('.shaka-play-button, .vjs-big-play-button, button[aria-label="Play"]').forEach((btn) => {
        try {
          btn.click();
        } catch (e) {}
      });
    }, 200);

    setTimeout(() => clearInterval(clickerInterval), 25000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoClicker);
  } else {
    initAutoClicker();
  }
})();
