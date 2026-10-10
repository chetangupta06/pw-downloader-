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
    /(subodhpgcollege|code\.run|streamthorr|streamvideo\.co\.in)/i,
    /(testwave\.cc|bunny-cdn).*(\.m3u8|\.mpd|\/hls\/|\/dash\/)/i,
    /cors\.pwjarvis\.com/i,
    /\/video\/[a-f0-9]+\/\d+p\/video\.mp4/i,
  ];

  function checkAndReport(url) {
    if (!url || typeof url !== 'string') return;
    if (/\.(ts|m4s|aac|key|vtt|srt|jpg|jpeg|png|webp|svg|ico|css|woff2?|js|json)(\?|$)/i.test(url)) return;
    if (url.includes('/enc.key') || url.includes('/get-hls-key')) return;
    // Ignore segment chunks disguised as PDF on testwave / bunny-cdn
    if ((url.includes('testwave.cc') || url.includes('bunny-cdn')) && url.includes('.pdf')) return;

    if (PW_PATTERNS.some((p) => p.test(url))) {
      chrome.runtime.sendMessage({ type: 'SET_URL', url }, () => {
        // Ignore errors (e.g., background not ready)
        if (chrome.runtime.lastError) {}
      });
    }
  }

  // --- Hook window messages from inject.js (MAIN world) ---
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'PW_PLAYLIST_DETECTED' && event.data.playlist) {
      chrome.runtime.sendMessage({ 
        type: 'SET_PLAYLIST', 
        playlist: event.data.playlist, 
        url: event.data.url || null,
        blobUrl: event.data.blobUrl, 
        title: event.data.title || document.title 
      });
    }
    if (event.data && event.data.type === 'PW_URL_DETECTED' && event.data.url) {
      checkAndReport(event.data.url);
    }
  });

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

  // --- Hook URL.createObjectURL to catch decrypted blob playlists ---
  const origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function(obj) {
    if (obj instanceof Blob) {
      if (obj.type && (obj.type.includes('javascript') || obj.type.includes('json') || obj.type.includes('css'))) {
        return origCreateObjectURL.apply(this, arguments);
      }
      obj.text().then(text => {
        if (isValidM3U8(text)) {
          chrome.runtime.sendMessage({
            type: 'SET_PLAYLIST',
            playlist: text,
            title: document.title
          });
        }
      }).catch(() => {});
    }
    return origCreateObjectURL.apply(this, arguments);
  };


  // --- Patch fetch ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
    checkAndReport(url);

    if (/\.(js|json|css|wasm|html)(\?|$)/i.test(url)) {
      return originalFetch.apply(this, args);
    }
    
    try {
        const response = await originalFetch.apply(this, args);
        const clonedResponse = response.clone();
        
        clonedResponse.text().then(text => {
            if (isValidM3U8(text)) {
                if (!url.includes('enc.key')) {
                    chrome.runtime.sendMessage({ type: 'SET_PLAYLIST', playlist: text, url: response.url || url, title: document.title });
                    chrome.runtime.sendMessage({ type: 'SET_URL', url: response.url || url });
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
    
    if (!/\.(js|json|css|wasm|html)(\?|$)/i.test(url)) {
      this.addEventListener('load', function() {
          try {
              const responseText = this.responseText;
              if (isValidM3U8(responseText)) {
                  if (!url.includes('enc.key')) {
                      chrome.runtime.sendMessage({ type: 'SET_PLAYLIST', playlist: responseText, url: this.responseURL || url, title: document.title });
                      chrome.runtime.sendMessage({ type: 'SET_URL', url: this.responseURL || url });
                  }
              }
          } catch(e) {}
      });
    }
    return originalXhrOpen.apply(this, [method, url, ...rest]);
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
    const allowedDomains = ['vidcloud.eu.org', 'rarestudy.in', 'samfygros.com', 'pwthor.live', 'pwjarvis.com', 'streamvideo.co.in'];
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
