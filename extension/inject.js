// PW Lecture Downloader - Injected Script (MAIN world)
// Defeats frontend obfuscation, Shaka Player, Hls.js, CryptoJS, and dynamic media setters

(function() {
  if (window.__pwMainWorldInjected) return;
  window.__pwMainWorldInjected = true;

  const PW_PATTERNS = [
    /sec-prod-mediacdn\.pw\.live\/[^?]+master\.(m3u8|mpd)/i,
    /sec-prod-mediacdn\.pw\.live\/[^?]+\/hls\/\d+\/main\.m3u8/i,
    /cdn\.penpencil\.co\/.*master\.(m3u8|mpd)/i,
    /cloudfront\.net\/.*master\.(m3u8|mpd)/i,
    /cloudfront\.net\/.*\/hls\//i,
    /(testwave\.cc|bunny-cdn).*(\.m3u8|\.mpd|\/hls\/|\/dash\/)/i,
    /cors\.pwjarvis\.com/i,
    /(subodhpgcollege|code\.run|streamthorr|pwthor|streamvideo\.co\.in)/i,
    /\/dash\//i,
    /\/hls\/\d+\/main\.m3u8/i,
    /\/hls\/main\.m3u8/i,
    /\/video\/[a-f0-9]+\/\d+p\/video\.mp4/i,
    /master\.(m3u8|mpd).*(Policy=|Signature=)/i,
  ];

  function isStreamUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('blob:')) return false;
    // Ignore non-manifest chunks, keys, subtitles, images, styles, scripts
    if (/\.(ts|m4s|aac|key|vtt|srt|jpg|jpeg|png|webp|svg|ico|css|woff2?|js|json)(\?|$)/i.test(url)) return false;
    if (url.includes('/enc.key') || url.includes('/get-hls-key')) return false;
    if ((url.includes('testwave.cc') || url.includes('bunny-cdn')) && url.includes('.pdf')) return false;

    if (/\.(m3u8|mpd)(\?|$)/i.test(url)) return true;
    if (/\/hls\/|\/dash\//i.test(url)) return true;
    if (/\/stream\//i.test(url)) return true;
    if (/(subodhpgcollege|code\.run|streamthorr|pwthor|streamvideo\.co\.in|cors\.pwjarvis\.com)/i.test(url)) return true;
    if (/\/video\/[a-f0-9]+\/\d+p\/video\.mp4/i.test(url)) return true;
    if (/(Policy=|Signature=)/i.test(url) && (url.includes('.m3u8') || url.includes('.mpd') || url.includes('/hls/'))) return true;
    return PW_PATTERNS.some(p => p.test(url));
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

  function checkAndReport(text, sourceUrl) {
    if (!text || typeof text !== 'string') return;
    if (text.startsWith('blob:')) return;
    if (/\.(ts|m4s|aac|key|vtt|srt|jpg|jpeg|png|webp|svg|ico|css|woff2?|js|json)(\?|$)/i.test(text)) return;
    if (text.includes('/enc.key') || text.includes('/get-hls-key')) return;
    if ((text.includes('testwave.cc') || text.includes('bunny-cdn')) && text.includes('.pdf')) return;
    
    // In-memory M3U8 playlist
    if (isValidM3U8(text)) {
      window.postMessage({ type: 'PW_PLAYLIST_DETECTED', playlist: text, url: sourceUrl || null, title: document.title }, '*');
      return;
    }

    let foundUrl = text.trim();
    // JSON payloads containing embedded stream URLs
    if (foundUrl.includes('{') && foundUrl.includes('}')) {
      const match = foundUrl.match(/(https?:\/\/[^\s"'`]+?\.(m3u8|mpd)[^\s"'`]*)/i) || 
                    foundUrl.match(/(https?:\/\/[^\s"'`]+?\/stream\/[^\s"'`]*)/i) ||
                    foundUrl.match(/(https?:\/\/[^\s"'`]+?\/(?:hls|dash)\/[^\s"'`]*)/i);
      if (match) {
        foundUrl = match[1];
      }
    }

    if (isStreamUrl(foundUrl)) {
      window.postMessage({ type: 'PW_URL_DETECTED', url: foundUrl, title: document.title }, '*');
    }
  }

  // --- 1. Patch fetch ---
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (url) checkAndReport(url, url);
    return originalFetch.apply(this, args);
  };

  // --- 2. Patch XMLHttpRequest ---
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (url) checkAndReport(url, url);
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  // --- 3. Hook CryptoJS (Defeat vidcloud.eu.org AES encryption) ---
  let _CryptoJS = window.CryptoJS;
  function hookDecrypt(cryptoObj) {
    if (!cryptoObj || !cryptoObj.AES || cryptoObj.AES.decrypt._pwHooked) return;
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

  if (_CryptoJS) hookDecrypt(_CryptoJS);
  try {
    Object.defineProperty(window, 'CryptoJS', {
      get: function() { return _CryptoJS; },
      set: function(val) {
        _CryptoJS = val;
        hookDecrypt(_CryptoJS);
      },
      configurable: true
    });
  } catch(e) {}

  // --- 4. Hook URL.createObjectURL ---
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

  // --- 5. Hook Shaka Player ---
  function hookShaka(shakaObj) {
    if (!shakaObj || !shakaObj.Player || !shakaObj.Player.prototype || shakaObj.Player.prototype.load._pwHooked) return;
    const origLoad = shakaObj.Player.prototype.load;
    shakaObj.Player.prototype.load = function(assetUri, ...rest) {
      if (typeof assetUri === 'string') {
        if (assetUri.startsWith('blob:')) {
          fetch(assetUri).then(r => r.text()).then(text => {
            if (isValidM3U8(text)) {
              console.log('[PW Downloader] Intercepted M3U8 from Shaka Player load!');
              window.postMessage({ type: 'PW_PLAYLIST_DETECTED', playlist: text, blobUrl: assetUri, title: document.title }, '*');
            }
          }).catch(() => {});
        } else {
          checkAndReport(assetUri);
        }
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

  // --- 6. Hook Hls.js ---
  function hookHls(hlsObj) {
    if (!hlsObj || !hlsObj.prototype || hlsObj.prototype.loadSource._pwHooked) return;
    const origLoadSource = hlsObj.prototype.loadSource;
    hlsObj.prototype.loadSource = function(url, ...rest) {
      if (typeof url === 'string') {
        checkAndReport(url);
      }
      return origLoadSource.call(this, url, ...rest);
    };
    hlsObj.prototype.loadSource._pwHooked = true;
  }

  if (window.Hls) hookHls(window.Hls);
  let _Hls = window.Hls;
  try {
    Object.defineProperty(window, 'Hls', {
      get: function() { return _Hls; },
      set: function(val) {
        _Hls = val;
        hookHls(_Hls);
      },
      configurable: true
    });
  } catch(e) {}

  // --- 7. Hook HTMLMediaElement.prototype.src & play() ---
  try {
    const origSrcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (origSrcDesc && origSrcDesc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        get: function() { return origSrcDesc.get.call(this); },
        set: function(val) {
          if (typeof val === 'string' && val) {
            checkAndReport(val);
          }
          return origSrcDesc.set.call(this, val);
        },
        configurable: true
      });
    }

    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(...args) {
      if (this.currentSrc) checkAndReport(this.currentSrc);
      if (this.src) checkAndReport(this.src);
      return origPlay.apply(this, args);
    };
  } catch(e) {}

  // --- 8. Periodic DOM scanning ---
  setInterval(() => {
    document.querySelectorAll('video, source').forEach((el) => {
      if (el.src) checkAndReport(el.src);
      if (el.currentSrc) checkAndReport(el.currentSrc);
    });
    document.querySelectorAll('input[type="hidden"]').forEach((el) => {
      if (el.value && (el.value.includes('.m3u8') || el.value.includes('.mpd'))) {
        checkAndReport(el.value);
      }
    });
  }, 500);
})();
