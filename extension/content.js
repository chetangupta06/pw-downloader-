// PW Lecture Downloader - Content Script
// Runs on every page as a secondary interception layer.
// Injects a script into the MAIN world to hook fetch, XHR, and CryptoJS,
// defeating frontend obfuscation (like vidcloud.eu.org's crypto-js).

function mainWorldHooks() {
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
    // Universal Match: Any master playlist with an AWS Policy/Signature
    /master\.(m3u8|mpd).*(Policy=|Signature=)/i,
  ];

  function checkAndReport(text) {
    if (!text || typeof text !== 'string') return;
    if (text.startsWith('blob:')) return; // Ignore blob wrappers
    
    let foundUrl = text;
    // If the text is JSON, try to extract the URL from inside it
    if (text.includes('{') && text.includes('}')) {
        const match = text.match(/(https?:\/\/[^\"]*?master\.(m3u8|mpd)[^\"]*)/i);
        if (match) {
            foundUrl = match[1];
        }
    }
    
    // Also check for standard URL formats if it's deeply nested
    if (!PW_PATTERNS.some((p) => p.test(foundUrl))) {
        const fallbackMatch = text.match(/(https?:\/\/[^\"]*?(Policy=|Signature=)[^\"]*)/i);
        if (fallbackMatch && (fallbackMatch[1].includes('.m3u8') || fallbackMatch[1].includes('.mpd'))) {
            foundUrl = fallbackMatch[1];
        }
    }

    if (PW_PATTERNS.some((p) => p.test(foundUrl))) {
      window.postMessage({ type: 'PW_URL_DETECTED', url: foundUrl, title: document.title }, '*');
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
  
  // --- Hook CryptoJS (Defeat vidcloud.eu.org encryption) ---
  let _CryptoJS = window.CryptoJS;
  
  function hookDecrypt(cryptoObj) {
      if (!cryptoObj || !cryptoObj.AES) return;
      // Prevent double hooking
      if (cryptoObj.AES.decrypt._pwHooked) return;
      
      const origDecrypt = cryptoObj.AES.decrypt;
      cryptoObj.AES.decrypt = function() {
          const result = origDecrypt.apply(this, arguments);
          try {
              const decryptedStr = result.toString(cryptoObj.enc.Utf8);
              if (decryptedStr) {
                  checkAndReport(decryptedStr);
              }
          } catch(e) {}
          return result;
      };
      cryptoObj.AES.decrypt._pwHooked = true;
  }
  
  if (_CryptoJS) {
      hookDecrypt(_CryptoJS);
  }
  
  // Intercept if CryptoJS is loaded dynamically later
  Object.defineProperty(window, 'CryptoJS', {
      get: function() { return _CryptoJS; },
      set: function(val) {
          _CryptoJS = val;
          hookDecrypt(_CryptoJS);
      },
      configurable: true
  });

  // --- Scan DOM periodically ---
  setInterval(() => {
    document.querySelectorAll('video[src], source[src]').forEach((el) => checkAndReport(el.src));
    // Check hidden inputs for encrypted/plain URLs just in case
    document.querySelectorAll('input[type="hidden"]').forEach((el) => {
        if (el.value.includes('.m3u8') || el.value.includes('.mpd')) checkAndReport(el.value);
    });
  }, 2000);
}

// Inject the main world script
const script = document.createElement('script');
script.textContent = '(' + mainWorldHooks.toString() + ')();';
(document.head || document.documentElement).appendChild(script);
script.remove();

// --- ISOLATED WORLD LISTENER ---
window.addEventListener('message', function(event) {
  if (event.source !== window || !event.data || event.data.type !== 'PW_URL_DETECTED') return;
  
  // Send the stolen URL to the background script!
  chrome.runtime.sendMessage({ type: 'SET_URL', url: event.data.url, title: event.data.title }, () => {
      if (chrome.runtime.lastError) {}
  });
});
