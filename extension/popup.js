// PW Lecture Downloader - Popup Logic
const HF_BACKEND = 'https://chetangupta06-pw-downloader.hf.space';

let detectedUrl = null;
let selectedQualityUrl = null;
let qualities = [];
let downloadFileUrl = null;
let totalSegments = 0;
let downloadedSegments = 0;

// --- State management ---
function showState(id) {
  document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showError(msg) {
  document.getElementById('error-message').textContent = msg;
  showState('state-error');
}

// --- Terminal logger ---
function addLog(message, type = '') {
  const terminal = document.getElementById('dl-terminal');
  const line = document.createElement('div');
  line.className = 'log-line';
  const time = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="log-time">[${time}]</span><span class="log-msg ${type}">${message}</span>`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

// --- Quality label helper ---
function qualityLabel(q) {
  if (q.resolution && q.resolution.includes('x')) return `${q.resolution.split('x')[1]}p`;
  if (q.resolution) return q.resolution;
  return 'Auto';
}

// --- Init: ask background for the current tab's detected URL ---
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  chrome.runtime.sendMessage({ type: 'GET_URL', tabId: tab.id }, (resp) => {
    if (resp && resp.url) {
      detectedUrl = resp.url;
      document.getElementById('url-display').textContent = resp.url;
      showState('state-detected');
    } else {
      showState('state-waiting');
    }
  });
}

// --- Fetch quality options from HF backend ---
async function fetchQualities() {
  if (!detectedUrl) return;
  showState('state-loading');
  try {
    const resp = await fetch(`${HF_BACKEND}/api/parse?url=${encodeURIComponent(detectedUrl)}`);
    if (!resp.ok) throw new Error(`Backend returned ${resp.status}`);
    const data = await resp.json();
    qualities = data.qualities || [];
    if (qualities.length === 0) throw new Error('No video qualities found in the playlist.');
    renderQualities();
    showState('state-quality');
  } catch (err) {
    showError(`Failed to fetch qualities:\n${err.message}\n\nMake sure the HF backend is running.`);
  }
}

// --- Render quality buttons ---
function renderQualities() {
  const grid = document.getElementById('quality-grid');
  grid.innerHTML = '';
  document.getElementById('quality-count').textContent = `Found ${qualities.length} quality${qualities.length > 1 ? 's' : ''}`;
  selectedQualityUrl = null;
  document.getElementById('btn-download').disabled = true;

  const sorted = [...qualities].sort((a, b) => {
    const h = q => q.resolution?.includes('x') ? parseInt(q.resolution.split('x')[1], 10) : (q.bandwidth || 0);
    return h(b) - h(a);
  });

  sorted.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.className = 'quality-btn';
    btn.textContent = qualityLabel(q);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedQualityUrl = q.url;
      document.getElementById('btn-download').disabled = false;
    });
    grid.appendChild(btn);
    if (idx === 0) btn.click(); // auto-select best quality
  });
}

// --- START DOWNLOAD directly inside the popup ---
async function startDownload() {
  if (!selectedQualityUrl) return;

  // Reset progress UI
  downloadFileUrl = null;
  totalSegments = 0;
  downloadedSegments = 0;
  document.getElementById('dl-bar').style.width = '0%';
  document.getElementById('dl-percent').textContent = '0%';
  document.getElementById('stat-segs').textContent = '0';
  document.getElementById('stat-mb').textContent = '0.00';
  document.getElementById('stat-est').textContent = 'N/A';
  document.getElementById('dl-status').textContent = '⬇️ Downloading...';
  document.getElementById('dl-terminal').innerHTML = '';
  document.getElementById('btn-save').style.display = 'none';
  showState('state-downloading');

  addLog('Starting download request to backend...');

  try {
    // Step 1: Kick off download job on the backend
    const startResp = await fetch(`${HF_BACKEND}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: selectedQualityUrl })
    });
    if (!startResp.ok) throw new Error(`Backend error: ${startResp.status}`);
    const { sessionId } = await startResp.json();
    addLog(`Session created: ${sessionId.slice(-8)}...`);

    // Step 2: Connect to SSE progress stream
    const evtSource = new EventSource(`${HF_BACKEND}/api/events?sessionId=${sessionId}`);

    evtSource.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      const msg = data.message.includes('] ') ? data.message.split('] ').slice(1).join('] ') : data.message;
      addLog(msg);
    });

    evtSource.addEventListener('info', (e) => {
      const data = JSON.parse(e.data);
      totalSegments = data.totalSegments;
      document.getElementById('stat-segs').textContent = `0/${totalSegments}`;
    });

    evtSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      if (data.isDirectMB) {
        downloadedSegments = data.downloadedCount || 0;
        const pct = totalSegments > 0 ? Math.round((downloadedSegments / totalSegments) * 100) : 0;
        document.getElementById('dl-bar').style.width = `${pct}%`;
        document.getElementById('dl-percent').textContent = `${pct}%`;
        document.getElementById('stat-segs').textContent = totalSegments > 0 ? `${downloadedSegments}/${totalSegments}` : downloadedSegments;
        document.getElementById('stat-mb').textContent = data.downloadedMB || '0.00';
        document.getElementById('stat-est').textContent = data.estMB ? `${data.estMB} MB` : 'N/A';
      } else {
        // Sequential DASH mode
        downloadedSegments = data.downloaded || 0;
        document.getElementById('stat-segs').textContent = downloadedSegments;
        const mbEst = ((downloadedSegments * 0.3)).toFixed(1);
        document.getElementById('stat-mb').textContent = mbEst;
        // Animate bar gently
        const fakePercent = Math.min((downloadedSegments / 150) * 80, 80);
        document.getElementById('dl-bar').style.width = `${fakePercent}%`;
        document.getElementById('dl-percent').textContent = `${Math.round(fakePercent)}%`;
      }
    });

    evtSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      downloadFileUrl = `${HF_BACKEND}${data.fileUrl}`;
      evtSource.close();

      // Fill bar to 100%
      document.getElementById('dl-bar').style.width = '100%';
      document.getElementById('dl-percent').textContent = '100%';
      document.getElementById('dl-status').textContent = '✅ Download Complete!';
      addLog('Download ready! Click Save to get your file.', 'ok');

      // Show Save button
      const saveBtn = document.getElementById('btn-save');
      saveBtn.style.display = 'block';
    });

    evtSource.addEventListener('error', (e) => {
      try {
        const data = JSON.parse(e.data);
        addLog(`Error: ${data.error}`, 'err');
        document.getElementById('dl-status').textContent = '❌ Download Failed';
      } catch (_) {
        addLog('Connection lost or backend error.', 'err');
        document.getElementById('dl-status').textContent = '❌ Connection Lost';
      }
      evtSource.close();
    });

  } catch (err) {
    showError(`Download failed:\n${err.message}`);
  }
}

// --- Save the downloaded file ---
function saveFile() {
  if (!downloadFileUrl) return;
  // Open the direct download link in a new tab - browser will download it
  chrome.tabs.create({ url: downloadFileUrl });
  window.close();
}

// --- Clear detected URL ---
async function clearUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.runtime.sendMessage({ type: 'CLEAR_URL', tabId: tab.id }, () => {
      detectedUrl = null;
      selectedQualityUrl = null;
      showState('state-waiting');
    });
  }
}

// --- Event listeners ---
document.getElementById('btn-fetch').addEventListener('click', fetchQualities);
document.getElementById('btn-clear').addEventListener('click', clearUrl);
document.getElementById('btn-back').addEventListener('click', () => showState('state-detected'));
document.getElementById('btn-download').addEventListener('click', startDownload);
document.getElementById('btn-save').addEventListener('click', saveFile);
document.getElementById('btn-retry').addEventListener('click', () => {
  if (detectedUrl) fetchQualities();
  else showState('state-waiting');
});
document.getElementById('open-webapp').addEventListener('click', () => {
  chrome.tabs.create({ url: HF_BACKEND });
  window.close();
});

// --- Boot ---
init();
