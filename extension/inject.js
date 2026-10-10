// PW Lecture Downloader - Injected Script
// Defeats frontend obfuscation (like vidcloud.eu.org's crypto-js)

(function() {
  if (window.__pwMainWorldInjected) return;
  window.__pwMainWorldInjected = true;

  const PW_PATTERNS = [
    /sec-prod-mediacdn\.pw\.live\/[^?]+master\.m3u8/i,
    /sec-prod-mediacdn\.pw\.live\/[^?]+master\.mpd/i,
    /sec-prod-mediacdn\.pw\.live\/[^?]+\/hls\/\d+\/main\.m3u8/i,
    /cdn\.penpencil\.co\/.*master\.m3u8/i,
    /cdn\.penpencil\.co\/.*master\.mpd/i,
    /cloudfront\.net\/.*master\.m3u8/i,
    /cloudfront\.net\/.*master\.mpd/i,
    /(testwave\.cc|bunny-cdn).*(\.m3u8|\.mpd|\/hls\/|\/dash\/)/i,
    /cors\.pwjarvis\.com/i,
    /(subodhpgcollege|code\.run|streamthorr|pwthor|streamvideo\.co\.in)/i,
    /\/dash\//i,
    /\/hls\/\d+\/main\.m3u8/i,
    /\/hls\/main\.m3u8/i,
    /\/video\/[a-f0-9]+\/\d+p\/video\.mp4/i,
    // Universal Match: Any master playlist with an AWS Policy/Signature
    /master\.(m3u8|mpd).*(Policy=|Signature=)/i,
  ];


function isValidM3U8(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim().replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('#EXTM3U')) return false;
  // Strictly reject JS files / web workers that mention #EXTM3U as a string literal
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

function checkAndReport(text, sourceUrl) {
  if (!text || typeof text !== 'string') return;
  if (text.startsWith('blob:')) return; // Ignore blob wrappers
  if (/\.(ts|m4s|aac|key|vtt|srt|jpg|jpeg|png|webp|svg|ico|css|woff2?|js|json)(\?|$)/i.test(text)) return;
  if (text.includes('/enc.key') || text.includes('/get-hls-key')) return;
  // Ignore segment chunks disguised as PDF on testwave / bunny-cdn
  if ((text.includes('testwave.cc') || text.includes('bunny-cdn')) && text.includes('.pdf')) return;
  
  // If the text itself is an in-memory M3U8 playlist
  if (isValidM3U8(text)) {
    window.postMessage({ type: 'PW_PLAYLIST_DETECTED', playlist: text, url: sourceUrl || null, title: document.title }, '*');
    return;
  }

  let foundUrl = text;
  // If the text is JSON, try to extract the URL from inside it
  if (text.includes('{') && text.includes('}')) {
      const match = text.match(/(https?:\/\/[^\"]*?\.(m3u8|mpd)[^\"]*)/i) || text.match(/(https?:\/\/[^\"]*?\/stream\/[^\"]*)/i);
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
  checkAndReport(url, url);
  return originalFetch.apply(this, args);
};

// --- Patch XMLHttpRequest ---
const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  checkAndReport(url, url);
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

// --- Hook URL.createObjectURL (catches full M3U8 blob playlists) ---
const _origCreateObjectURL = URL.createObjectURL;
URL.createObjectURL = function(obj) {
  const resultUrl = _origCreateObjectURL.apply(this, arguments);
  if (obj instanceof Blob) {
    if (obj.type && (obj.type.includes('javascript') || obj.type.includes('json') || obj.type.includes('css'))) return resultUrl;
    obj.text().then(text => {
      if (isValidM3U8(text)) {
        console.log('[PW Downloader] Intercepted full M3U8 blob playlist!');
        window.postMessage({ type: 'PW_PLAYLIST_DETECTED', playlist: text, blobUrl: resultUrl, title: document.title }, '*');
      }
    }).catch(() => {});
  }
  return resultUrl;
};

// --- Hook Shaka Player manifest loading ---
function hookShaka(shakaObj) {
  if (!shakaObj || !shakaObj.Player || shakaObj.Player.prototype.load._pwHooked) return;
  const origLoad = shakaObj.Player.prototype.load;
  shakaObj.Player.prototype.load = function(assetUri, ...rest) {
    if (typeof assetUri === 'string' && assetUri.startsWith('blob:')) {
      fetch(assetUri).then(r => r.text()).then(text => {
        if (isValidM3U8(text)) {
          console.log('[PW Downloader] Intercepted M3U8 from Shaka Player load!');
          window.postMessage({ type: 'PW_PLAYLIST_DETECTED', playlist: text, blobUrl: assetUri, title: document.title }, '*');
        }
      }).catch(() => {});
    }
    return origLoad.call(this, assetUri, ...rest);
  };
  shakaObj.Player.prototype.load._pwHooked = true;
}

if (window.shaka) hookShaka(window.shaka);
let _shaka = window.shaka;
try {
  Object.defineProperty(window, 'shaka', {
    get: function() { return _shaka; },
    set: function(val) {
      _shaka = val;
      hookShaka(_shaka);
    },
    configurable: true
  });
} catch(e) {}

// --- Scan DOM periodically ---
setInterval(() => {
  document.querySelectorAll('video[src], source[src]').forEach((el) => checkAndReport(el.src));
  // Check hidden inputs for encrypted/plain URLs just in case
  document.querySelectorAll('input[type="hidden"]').forEach((el) => {
      if (el.value.includes('.m3u8') || el.value.includes('.mpd')) checkAndReport(el.value);
  });
}, 2000);
})();

