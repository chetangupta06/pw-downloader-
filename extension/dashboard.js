// PW Bulk Chapter Downloader - Dual Engine
function getApiConfig() {
  const srv = document.getElementById('api-server').value;
  let base = '';
  if (srv === 'pwthor') base = 'https://pwthor.live';
  else if (srv === 'pwjarvis') base = 'https://pwjarvis.com';
  else if (srv === 'samfygros') base = 'https://s3-cdn.samfygros.com/radha';
  else base = 'https://api.penpencil.co';
  
  return {
    type: srv,
    base: base
  };
}

let cachedVidcloudToken = null;
let vidcloudTokenExpiry = 0;

async function getVidcloudToken() {
  if (cachedVidcloudToken && Date.now() < vidcloudTokenExpiry) {
    return cachedVidcloudToken;
  }
  try {
    const res = await fetch('https://vidcloud.eu.org/generate_token.php', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.ok) {
      const data = await res.json();
      cachedVidcloudToken = data.access_token || data.token;
      vidcloudTokenExpiry = Date.now() + 10 * 60 * 1000;
      return cachedVidcloudToken;
    }
  } catch (e) {
    console.warn("Failed to get Vidcloud token:", e);
  }
  return null;
}

let allVideos = [];
let dirHandle = null;

function logTerminal(msg, type = '') {
  const term = document.getElementById('terminal');
  if (!term) return;
  const d = new Date();
  const timeStr = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
  const el = document.createElement('div');
  el.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="log-${type}">${msg}</span>`;
  term.appendChild(el);
  term.scrollTop = term.scrollHeight;
}

// Auto-detect Batch ID from open PW tabs
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const tabs = await chrome.tabs.query({});
    // Prioritize active tabs
    tabs.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
    
    for (const tab of tabs) {
      if (!tab.url) continue;

      // 1. PW Jarvis tab detection
      if (tab.url.includes('pwjarvis.com')) {
        const jarvisMatch = tab.url.match(/\/study\/batches\/([^/?#]+)/);
        if (jarvisMatch) {
          document.getElementById('api-server').value = 'pwjarvis';
          document.getElementById('batch-id').value = jarvisMatch[1];
          logTerminal(`Auto-detected PW Jarvis Batch: ${jarvisMatch[1]}`, 'ok');
          document.getElementById('btn-fetch-subjects').click();
          break;
        }
      }

      // 2. Standard 24-hex Mongo ID detection
      const match = tab.url.match(/(?:batches|batch|details\/|details\?id=)([a-fA-F0-9]{24})/);
      if (match) {
        const batchField = document.getElementById('batch-id');
        batchField.value = match[1];
        logTerminal(`Auto-detected Batch ID: ${match[1]} (${tab.url.includes('pwjarvis') ? 'PW Jarvis' : 'Active Tab'})`, 'ok');
        document.getElementById('btn-fetch-subjects').click();
        break;
      }
    }
  } catch(e) {}
});

// 1. Fetch Subjects
document.getElementById('btn-fetch-subjects').addEventListener('click', async () => {
  let rawBatch = document.getElementById('batch-id').value.trim();
  if (!rawBatch) return alert('Enter a Batch ID or URL');
  
  // Normalize if user pasted a full URL or slug
  const urlMatch = rawBatch.match(/(?:batches|batch|details\/|details\?id=)\/?([a-zA-Z0-9_-]+)/);
  const batchId = urlMatch ? urlMatch[1] : rawBatch;
  document.getElementById('batch-id').value = batchId;
  
  const api = getApiConfig();
  logTerminal(`Fetching subjects for batch ${batchId}...`);
  
  try {
    let subjects = [];
    
    // 1. Try official Physics Wallah API first: 100% public, CORS enabled (*), fast & contains ALL subjects for every batch!
    try {
      const res = await fetch(`https://api.penpencil.co/v3/batches/${batchId}/details`);
      if (res.ok) {
        const data = await res.json();
        subjects = data?.data?.subjects || [];
        window.currentBatchId = data?.data?._id || batchId;
        window.currentBatchSlug = data?.data?.slug || batchId;
      }
    } catch (e) {
      console.warn("Direct penpencil fetch failed, trying proxy fallback:", e);
    }
    
    // 2. Fallback to server-specific API if native did not return subjects
    if (!subjects || subjects.length === 0) {
      if (api.type === 'pwthor') {
        const res = await fetch(`${api.base}/api/BatchInfo?BatchId=${batchId}&Type=details`, {
          headers: { "Content-Type": "application/json" }
        });
        const data = await res.json();
        subjects = data?.data?.subjects || [];
      } else {
        const res = await fetch(`${api.base}/v3/batches/${batchId}/details`, { credentials: 'include' });
        const data = await res.json();
        subjects = data?.data?.subjects || [];
      }
    }
    
    if (!subjects || subjects.length === 0) {
      logTerminal(`No subjects found for Batch ID ${batchId}. Please check the Batch ID.`, 'err');
      alert(`No subjects found for Batch ID: ${batchId}\nPlease check if the Batch ID is correct.`);
      return;
    }
    
    const sel = document.getElementById('select-subject');
    sel.innerHTML = '';
    subjects.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s._id || s.slug;
      opt.dataset.slug = s.slug || s._id;
      opt.dataset.id = s._id || s.slug;
      opt.textContent = s.subject;
      sel.appendChild(opt);
    });
    
    document.getElementById('group-subject').style.display = 'flex';
    
    const activeBatchId = window.currentBatchId || batchId;
    // Automatically load chapters for the first subject
    if (sel.value) loadChapters(activeBatchId, sel.value);
    sel.onchange = () => loadChapters(activeBatchId, sel.value);
    
    logTerminal(`Fetched ${subjects.length} subjects successfully.`, 'ok');
  } catch (err) {
    logTerminal(`Error fetching subjects: ${err.message}`, 'err');
  }
});

// 2. Fetch Chapters
async function loadChapters(batchId, subjectId) {
  try {
    const resolvedBatchId = window.currentBatchId || batchId;
    logTerminal(`Fetching chapters for subject...`);
    const api = getApiConfig();
    let page = 1;
    let allTopics = [];
    
    while (true) {
      let topics = [];

      // 1. Direct Official Physics Wallah V1 API (100% public, CORS *, contains all chapters)
      try {
        const res = await fetch(`https://api.penpencil.co/v1/batches/${resolvedBatchId}/subject/${subjectId}/topics?page=${page}`);
        if (res.ok) {
          const data = await res.json();
          topics = data?.data || [];
        }
      } catch (e) {
        console.warn("Direct penpencil topics fetch failed:", e);
      }

      // 2. Vidcloud V1 API fallback
      if (topics.length === 0) {
        try {
          const res = await fetch(`https://vidcloud.eu.org/api/v1/batches/${resolvedBatchId}/subject/${subjectId}/topics?page=${page}`);
          if (res.ok) {
            const data = await res.json();
            topics = data?.data || [];
          }
        } catch(e) {}
      }

      // 3. Server-specific fallback (PW Thor / Samfygros)
      if (topics.length === 0) {
        if (api.type === 'pwthor') {
          try {
            const res = await fetch(`${api.base}/api/SubjectInfo?BatchId=${resolvedBatchId}&SubjectId=${subjectId}&page=${page}`, {
              headers: { "Content-Type": "application/json" }
            });
            if (res.ok) {
              const data = await res.json();
              topics = data?.data || [];
            }
          } catch(e) {}
        } else if (api.type === 'samfygros') {
          try {
            const res = await fetch(`${api.base}/v1/batches/${resolvedBatchId}/subject/${subjectId}/topics?page=${page}`, { credentials: 'include' });
            if (res.ok) {
              const data = await res.json();
              topics = data?.data || [];
            }
          } catch(e) {}
        }
      }
      
      if (!topics || topics.length === 0) break;
      
      allTopics = allTopics.concat(topics);
      if (topics.length < 15) break; // Reached last page
      page++;
      if (page > 20) break;
    }
    
    const sel = document.getElementById('select-chapter');
    sel.innerHTML = '';
    
    if (allTopics.length === 0) {
      logTerminal(`No chapters found for this subject.`, 'warn');
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '-- No Chapters Available --';
      sel.appendChild(opt);
      document.getElementById('group-chapter').style.display = 'flex';
      return;
    }

    allTopics.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t._id || t.slug;
      opt.dataset.slug = t.slug || t._id;
      opt.dataset.id = t._id || t.slug;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    
    document.getElementById('group-chapter').style.display = 'flex';
    // Clear previous items list when chapter changes
    document.getElementById('step-2').style.display = 'none';
    document.getElementById('video-list').innerHTML = '';
    logTerminal(`Fetched ${allTopics.length} chapters successfully.`, 'ok');
  } catch (err) {
    logTerminal(`Error fetching chapters: ${err.message}`, 'err');
  }
}

// 3. Fetch Content
document.getElementById('btn-fetch-videos').addEventListener('click', async () => {
  const batchId = window.currentBatchId || document.getElementById('batch-id').value.trim();
  const subjectId = document.getElementById('select-subject').value;
  const topicId = document.getElementById('select-chapter').value;
  const contentType = document.getElementById('select-type').value;
  
  if (!topicId) {
    return alert('Please select a chapter first.');
  }

  const api = getApiConfig();
  allVideos = [];
  let page = 1;
  logTerminal(`Fetching ${contentType} list for selected chapter...`);
  
  while (true) {
    try {
      let vids = [];
      
      // 1. Try selected server first if pwthor
      if (api.type === 'pwthor') {
        try {
          const res = await fetch(`${api.base}/api/TopicInfo?BatchId=${batchId}&SubjectId=${subjectId}&TopicId=${topicId}&ContentType=${contentType}&page=${page}`, {
            headers: { "Content-Type": "application/json" }
          });
          if (res.ok) {
            const data = await res.json();
            vids = data.data || [];
          }
        } catch(e) {}
      }
      
      // 2. Try Vidcloud API with auto-generated token (universal across all batches)
      if (vids.length === 0) {
        try {
          const token = await getVidcloudToken();
          if (token) {
            const res = await fetch(`https://vidcloud.eu.org/api/v2/batches/${batchId}/subject/${subjectId}/contents?tag=${topicId}&contentType=${contentType}&page=${page}`, {
              headers: {
                'Authorization': `Bearer ${token}`,
                'client-id': '5eb393ee95fab7468a79d189'
              }
            });
            if (res.ok) {
              const data = await res.json();
              vids = data?.data || [];
            }
          }
        } catch(e) {
          console.warn("Vidcloud contents fetch failed:", e);
        }
      }
      
      // 3. Try Native Penpencil (with student token if available)
      if (vids.length === 0) {
        try {
          const stored = await chrome.storage.local.get(['pw_token']);
          const headers = { 'client-id': '5eb393ee95fab7468a79d189' };
          if (stored.pw_token) headers['Authorization'] = stored.pw_token.startsWith('Bearer ') ? stored.pw_token : `Bearer ${stored.pw_token}`;
          const res = await fetch(`https://api.penpencil.co/v2/batches/${batchId}/subject/${subjectId}/contents?tag=${topicId}&contentType=${contentType}&page=${page}`, {
            headers
          });
          if (res.ok) {
            const data = await res.json();
            vids = data?.data || [];
          }
        } catch(e) {}
      }
      
      if (!vids || vids.length === 0) break;
      if (page === 1 && vids.length > 0) {
        try { logTerminal(`<pre style="white-space: pre-wrap; font-size: 10px; user-select: all; margin: 4px 0; color: #a78bfa;">${JSON.stringify(vids[0])}</pre>`, 'warn'); } catch(e){}
      }
      allVideos = allVideos.concat(vids);
      if (vids.length < 15) break;
      page++;
      if (page > 25) break;
    } catch (err) {
      logTerminal(`Error fetching items on page ${page}: ${err.message}`, 'err');
      break;
    }
  }
  
  allVideos.reverse(); // Chronological order
  
  const list = document.getElementById('video-list');
  list.innerHTML = '';
  document.getElementById('video-count').textContent = allVideos.length;
  
  allVideos.forEach((v, i) => {
    let extractedName = v.topic || v.topicName || v.title || v.name;
    if (!extractedName && v.homeworkIds && v.homeworkIds.length > 0) {
        extractedName = v.homeworkIds[0].topic || v.homeworkIds[0].note;
    }
    const title = extractedName || `Item ${i+1}`;
    
    list.innerHTML += `
      <div class="video-item" id="vid-${i}">
        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; width: 100%;">
          <input type="checkbox" class="video-checkbox" data-index="${i}" checked style="width: 18px; height: 18px; accent-color: #7c3aed; cursor: pointer; flex-shrink: 0;" />
          <div class="video-info" style="flex: 1;">
            <div class="video-title">${i+1}. ${title}</div>
            <div class="video-status" id="status-${i}">Waiting...</div>
            <div class="dl-progress" id="prog-wrap-${i}">
              <div class="dl-progress-bar" id="prog-bar-${i}"></div>
            </div>
          </div>
        </label>
      </div>
    `;
  });
  
  document.getElementById('step-2').style.display = 'block';
  logTerminal(`Ready to download ${allVideos.length} items.`, 'ok');
  
  // Hook up Select All logic
  const checkAll = document.getElementById('check-all');
  if (checkAll) {
    checkAll.checked = true;
    checkAll.onchange = (e) => {
      document.querySelectorAll('.video-checkbox').forEach(cb => cb.checked = e.target.checked);
    };
  }
});

// 4. BULK DOWNLOAD ENGINE
document.getElementById('btn-start-bulk').addEventListener('click', async () => {
  const selectedCheckboxes = Array.from(document.querySelectorAll('.video-checkbox:checked'));
  if (selectedCheckboxes.length === 0) return alert('No items selected!');
  
  try {
    // Request permission to a directory
    if (window.showDirectoryPicker) {
        dirHandle = await window.showDirectoryPicker({
          mode: 'readwrite',
          startIn: 'downloads'
        });
    } else {
        // Fallback for Android (Kiwi/Lemur) which do not support showDirectoryPicker
        dirHandle = await navigator.storage.getDirectory();
        window.isMobileFallback = true;
    }
  } catch (err) {
    return logTerminal('Directory access cancelled.', 'warn');
  }
  
  document.getElementById('step-3').style.display = 'block';
  document.getElementById('btn-start-bulk').disabled = true;
  
  logTerminal(`Starting bulk download of ${selectedCheckboxes.length} selected items...`, 'ok');
  
  for (let cb of selectedCheckboxes) {
    const i = parseInt(cb.dataset.index);
    await downloadVideo(allVideos[i], i);
  }
  
  logTerminal('🎉 All downloads completed!', 'ok');
  document.getElementById('btn-start-bulk').disabled = false;
});

async function downloadVideo(vid, index) {
  const contentType = document.getElementById('select-type').value;
  const isVideo = contentType === 'videos' || contentType === 'DppVideos';
  
  let extractedName = vid.topic || vid.topicName || vid.title || vid.name;
  if (!extractedName && vid.homeworkIds && vid.homeworkIds.length > 0) {
      extractedName = vid.homeworkIds[0].topic || vid.homeworkIds[0].note;
  }
  const title = (extractedName || `Item ${index+1}`)
    .replace(/[^a-zA-Z0-9 _-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  const ext = isVideo ? '.mp4' : '.pdf';
  const prefix = contentType === 'DppNotes' ? '[DPP] ' : '';
  const finalFilename = `${prefix}${title}${ext}`;
  
  const statusEl = document.getElementById(`status-${index}`);
  const progWrap = document.getElementById(`prog-wrap-${index}`);
  const progBar = document.getElementById(`prog-bar-${index}`);
  
  const setStatus = (msg, type='') => {
    statusEl.textContent = msg;
    statusEl.className = 'video-status ' + type;
    logTerminal(`[${title}] ${msg}`, type);
  };
  
  document.getElementById(`vid-${index}`).scrollIntoView({ behavior: 'smooth', block: 'center' });
  
  try {
    if (!isVideo) {
        setStatus('Fetching PDF document...', 'active');
        
        let pdfUrl = null;
        if (vid.homeworkIds && vid.homeworkIds.length > 0) {
            const hw = vid.homeworkIds[0];
            if (hw.attachmentIds && hw.attachmentIds.length > 0) {
                const att = hw.attachmentIds[0];
                if (att.url) pdfUrl = att.url;
                else if (att.baseUrl && att.key) pdfUrl = att.baseUrl + att.key;
            } else if (hw.attachmentUrl) {
                pdfUrl = hw.attachmentUrl;
            }
        }
        if (!pdfUrl) pdfUrl = vid.attachmentUrl || vid.url || (vid.notes && vid.notes[0]?.url) || (vid.dpp && vid.dpp[0]?.url);
        
        // --- NEW FALLBACK FOR PHYSICS WALLAH SCHEDULE DETAILS ---
        // If the key was completely empty in the TopicInfo summary, we must fetch the full schedule details
        if (!pdfUrl) {
            setStatus('Fetching PDF details from server...', 'active');
            const batchId = document.getElementById('batch-id').value.trim();
            try {
                const token = await getVidcloudToken();
                const headers = { 'client-id': '5eb393ee95fab7468a79d189' };
                if (token) headers['Authorization'] = `Bearer ${token}`;
                const schedRes = await fetch(`https://vidcloud.eu.org/api/v1/batches/${batchId}/subject/dummy/schedule/${vid._id}/schedule-details`, { headers });
                const schedData = await schedRes.json();
                if (schedData && schedData.data && schedData.data.homeworkIds) {
                    const hwIdToMatch = (vid.homeworkIds && vid.homeworkIds.length > 0) ? vid.homeworkIds[0]._id : null;
                    const hw = hwIdToMatch ? schedData.data.homeworkIds.find(h => h._id === hwIdToMatch) : schedData.data.homeworkIds[0];
                    
                    if (hw && hw.attachmentIds && hw.attachmentIds.length > 0) {
                        const att = hw.attachmentIds[0];
                        if (att.url) pdfUrl = att.url;
                        else if (att.baseUrl && att.key) pdfUrl = att.baseUrl + att.key;
                    }
                }
            } catch (e) {
                console.error("Failed to fetch schedule-details", e);
            }
        }
        
        if (!pdfUrl) {
            console.log("No PDF URL found in:", vid);
            throw new Error("Could not locate PDF URL in API response.");
        }
        
        const pdfRes = await fetch(pdfUrl);
        if (!pdfRes.ok) throw new Error("Failed to download PDF stream.");
        
        // Write the PDF directly
        setStatus('Saving PDF...', 'active');
        const pdfBuffer = await pdfRes.arrayBuffer();
        const fileHandle = await dirHandle.getFileHandle(finalFilename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(pdfBuffer);
        await writable.close();
        
        setStatus('Saved Successfully!', 'success');
        return;
    }
    
    // --- VIDEO DOWNLOAD ENGINE ---
    // Step 4.1: Extract Signed URL via Background Network Interception
    setStatus('Extracting Signed URL (Network Intercept)...', 'active');
    
    const api = getApiConfig();
    const startTime = Date.now() - 500; // Allow 500ms grace period
    
    let watchUrl = '';
    if (api.type === 'pwjarvis') {
        const batchSlug = window.currentBatchSlug || document.getElementById('batch-id').value.trim();
        const subSel = document.getElementById('select-subject');
        const subjectSlug = subSel.options[subSel.selectedIndex]?.dataset?.slug || subSel.value;
        const topicSel = document.getElementById('select-chapter');
        const topicSlug = topicSel.options[topicSel.selectedIndex]?.dataset?.slug || topicSel.value;
        
        watchUrl = `https://www.pwjarvis.com/study/batches/${encodeURIComponent(batchSlug)}/subjects/${encodeURIComponent(subjectSlug)}/topics/${encodeURIComponent(topicSlug)}/schedule/${vid._id}`;
    } else if (api.type === 'pwthor') {
        watchUrl = `${api.base}/watch?batchId=${document.getElementById('batch-id').value.trim()}&SubjectId=${document.getElementById('select-subject').value}&ChildId=${vid._id}&Type=penpencilvdo`;
    } else if (api.type === 'rarestudy') {
        watchUrl = `https://rarestudy.in/schedule-details?batchId=${document.getElementById('batch-id').value.trim()}&subjectId=${document.getElementById('select-subject').value}&scheduleId=${vid._id}&tap=video`;
    } else {
        let actualVideoId = vid._id;
        let actualVideoUrl = vid.url || '';
        let actualImage = '';
        let actualTypeId = vid.typeId || '';
        let actualPlayType = 'Lecture';

        if (vid.videoDetails) {
            actualVideoId = vid.videoDetails.id || actualVideoId;
            actualVideoUrl = vid.videoDetails.videoUrl || actualVideoUrl;
            actualImage = vid.videoDetails.image || actualImage;
        } else if (vid.homeworkIds && vid.homeworkIds.length > 0) {
            const hw = vid.homeworkIds[0];
            actualVideoId = hw.videoId || hw._id || actualVideoId;
            actualVideoUrl = hw.videoUrl || hw.url || hw.attachmentUrl || actualVideoUrl;
            actualImage = hw.image || hw.imageUrl || hw.thumbnail || actualImage;
            actualTypeId = hw.typeId || actualTypeId;
            actualPlayType = 'Homework';
        } else if (vid.imageId && vid.imageId.baseUrl) {
            actualImage = vid.imageId.baseUrl + vid.imageId.key;
        }

        if (api.type === 'samfygros') {
            const params = new URLSearchParams({
                batch_id: document.getElementById('batch-id').value.trim(),
                video_id: actualVideoId,
                video_key: actualVideoId,
                subject_id_original: document.getElementById('select-subject').value,
                topic_id: document.getElementById('select-chapter').value
            });
            if (actualVideoUrl) params.append('video_url', actualVideoUrl);
            if (actualImage) params.append('poster', actualImage);
            params.append('title', title);
            params.append('video_type', 'pw');
            watchUrl = `https://s3-cdn.samfygros.com/play.php?${params.toString()}`;
        } else {
            const params = new URLSearchParams();
            // Hardcode known working IDs to bypass Vidcloud's database restrictions for new batches
            params.append('batch_id', '6779346f920e596fe7f0e247');
            params.append('program_id', '');
            params.append('subject_id', '69bebcb933cb41ec09dfcc85');
            params.append('topic_id', '69ccc6b5a01f2569524bfa63');
            params.append('video_id', actualVideoId);
            params.append('typeId', '6a7b1718f83a03099af69b2b');
            params.append('video_url', actualVideoUrl || '');
            params.append('video_name', title);
            params.append('video_img', actualImage);
            params.append('video_type', 'new');
            params.append('play_type', actualPlayType);
            
            watchUrl = `https://vidcloud.eu.org/play.php?${params.toString()}`;
        }
    }

    
    // Create an off-screen popup window so the player's visibility checks pass without stealing focus
    let tab;
    let winId = null;
    try {
        const win = await chrome.windows.create({ 
            url: watchUrl, 
            type: 'popup', 
            state: 'minimized'
        });
        tab = win.tabs[0];
        winId = win.id;
    } catch (e) {
        // Fallback for Android browsers like Kiwi or Lemur which do not support multiple windows
        tab = await chrome.tabs.create({ url: watchUrl, active: false });
    }
    
    // Clear any previously stored URL for this specific tab
    await new Promise(r => chrome.runtime.sendMessage({ type: 'CLEAR_URL', tabId: tab.id }, r));

    // Content.js automatically handles auto-clicking and muted play on the background tab

    let signedUrl = null;
    let attempts = 0;
    
    // Poll background script for URL (up to 25 seconds)
    while (!signedUrl && attempts < 250) {
        await new Promise(r => setTimeout(r, 100)); // 100ms
        attempts++;
        
        try {
            const resp = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_URL', tabId: tab.id, since: startTime }, r));
            if (resp && resp.url) {
                signedUrl = resp.url;
            }
        } catch(e) {}
    }
    
    // Clean up off-screen window or tab
    try {
        if (winId) chrome.windows.remove(winId);
        else chrome.tabs.remove(tab.id);
    } catch(e) {}
    
    if (!signedUrl || typeof signedUrl !== 'string' || signedUrl.startsWith("ERR:")) {
        throw new Error(signedUrl || 'Extraction timed out or returned null.');
    }

    // DIRECT MP4 STREAMING ENGINE (PW Jarvis & direct mp4 files)
    const isDirectMp4 = signedUrl.includes('cors.pwjarvis.com') || (signedUrl.includes('.mp4') && !signedUrl.includes('.m3u8'));

    if (isDirectMp4) {
        setStatus('Streaming direct MP4...', 'active');
        progWrap.style.display = 'block';
        progBar.style.width = '0%';
        progBar.textContent = '0%';

        const videoRes = await fetch(signedUrl);
        if (!videoRes.ok) throw new Error(`Video fetch HTTP ${videoRes.status}: ${videoRes.statusText}`);

        const totalBytes = parseInt(videoRes.headers.get('content-length')) || 0;
        const totalMbStr = totalBytes ? ` / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB` : '';

        const fileHandle = await dirHandle.getFileHandle(finalFilename, { create: true });
        const writable = await fileHandle.createWritable();

        const reader = videoRes.body.getReader();
        let downloadedBytes = 0;
        let lastTime = Date.now();
        let lastBytes = 0;
        let currentSpeed = '0.00';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            await writable.write(value);
            downloadedBytes += value.length;

            const now = Date.now();
            if (now - lastTime >= 400) {
                const durationSec = (now - lastTime) / 1000;
                const bytesDiff = downloadedBytes - lastBytes;
                const speedMbps = (bytesDiff / (1024 * 1024) / durationSec).toFixed(2);
                currentSpeed = speedMbps;
                lastTime = now;
                lastBytes = downloadedBytes;
            }

            if (totalBytes > 0) {
                const pct = Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100));
                const dlMb = (downloadedBytes / (1024 * 1024)).toFixed(1);
                progBar.style.width = `${pct}%`;
                progBar.textContent = `${pct}% (${dlMb}${totalMbStr} @ ${currentSpeed} MB/s)`;
            } else {
                const dlMb = (downloadedBytes / (1024 * 1024)).toFixed(1);
                progBar.style.width = '100%';
                progBar.textContent = `${dlMb} MB @ ${currentSpeed} MB/s`;
            }
        }

        await writable.close();
        progBar.style.width = '100%';
        progBar.textContent = '100% (Complete)';
        setStatus('Saved Successfully!', 'success');
        return;
    }

    // Bypass proxy servers (like testwave.cc) and fetch directly from CloudFront to avoid Origin blocks
    signedUrl = signedUrl.replace(/^https?:\/\/[^\/]+\/play\/(d1d34p8vz63oiq\.cloudfront\.net.*)/i, 'https://$1');
    
    // Revive dead Northflank/code.run domains back to the live Thor streaming server
    signedUrl = signedUrl.replace(/https?:\/\/[^\/]*code\.run/gi, 'https://stream.subodhpgcollege.site');

    // Intelligently convert direct DASH links back into the Master Playlist
    signedUrl = signedUrl.replace(/\/dash\/.*$/i, '/master.m3u8');

    // Ensure we use HLS for native processing
    signedUrl = signedUrl.replace('.mpd', '.m3u8');

    // Configure Declarative Net Request headers for the streaming domain BEFORE fetching playlists (bypasses Cloudflare 403)
    try {
        const streamUrlObj = new URL(signedUrl);
        const streamHost = streamUrlObj.hostname;
        
        let targetReferer = 'https://pwthor.live/';
        let targetOrigin = 'https://pwthor.live';
        if (signedUrl.includes('vidcloud')) {
            targetReferer = 'https://vidcloud.eu.org/';
            targetOrigin = 'https://vidcloud.eu.org';
        } else if (signedUrl.includes('samfygros')) {
            targetReferer = 'https://s3-cdn.samfygros.com/';
            targetOrigin = 'https://s3-cdn.samfygros.com';
        } else if (signedUrl.includes('rarestudy')) {
            targetReferer = 'https://rarestudy.in/';
            targetOrigin = 'https://rarestudy.in';
        }
        
        if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [9999],
                addRules: [{
                    id: 9999,
                    priority: 100,
                    action: {
                        type: "modifyHeaders",
                        requestHeaders: [
                            { header: "Referer", operation: "set", value: targetReferer },
                            { header: "Origin", operation: "set", value: targetOrigin }
                        ]
                    },
                    condition: {
                        urlFilter: `||${streamHost}`,
                        resourceTypes: ["xmlhttprequest", "media", "other"]
                    }
                }]
            });
        }
    } catch (e) {
        console.warn("Failed to set DNR header rule:", e);
    }
    
    setStatus('Parsing master playlist...', 'active');
    
    // Step 4.2: Fetch Master M3U8
    const mRes = await fetch(signedUrl);
    const masterManifest = await mRes.text();
    if (!mRes.ok) {
        throw new Error(`Master playlist HTTP ${mRes.status} (${mRes.statusText}): ${masterManifest.substring(0, 150)}`);
    }
    
    let bestQualityUrl = signedUrl;
    
    if (masterManifest.includes('#EXT-X-STREAM-INF')) {
        // Simple manual parsing to find the highest bandwidth
        const lines = masterManifest.split('\n');
        let maxBandwidth = 0;
        let bestUri = '';
        for (let j = 0; j < lines.length; j++) {
            if (lines[j].startsWith('#EXT-X-STREAM-INF')) {
                const bwMatch = lines[j].match(/BANDWIDTH=(\d+)/);
                if (bwMatch) {
                    const bw = parseInt(bwMatch[1]);
                    if (bw > maxBandwidth) {
                        maxBandwidth = bw;
                        bestUri = lines[j+1].trim();
                    }
                }
            }
        }
        if (bestUri) {
            const tempUrl = new URL(bestUri, signedUrl);
            const origUrl = new URL(signedUrl);
            origUrl.searchParams.forEach((value, key) => {
                tempUrl.searchParams.set(key, value);
            });
            bestQualityUrl = tempUrl.href;
        }
    }
    
    setStatus('Fetching media playlist...', 'active');
    const qRes = await fetch(bestQualityUrl);
    const mediaManifest = await qRes.text();
    if (!qRes.ok) {
        throw new Error(`Media playlist HTTP ${qRes.status} (${qRes.statusText}): ${mediaManifest.substring(0, 150)}`);
    }
    
    const lines = mediaManifest.split('\n');
    const segments = [];
    let aesKeyUrl = null;
    let aesKeyFallbackUrl = null;
    let aesKeyBuffer = null;
    let explicitIv = null;
    let mediaSequence = 0;
    
    for (let j = 0; j < lines.length; j++) {
        if (lines[j].startsWith('#EXT-X-KEY:METHOD=AES-128')) {
            const uriMatch = lines[j].match(/URI="([^"]+)"/);
            if (uriMatch) {
                const tempAes = new URL(uriMatch[1], bestQualityUrl);
                const origBest = new URL(bestQualityUrl);
                origBest.searchParams.forEach((v, k) => tempAes.searchParams.set(k, v));
                let finalAesUrl = tempAes.href;
                finalAesUrl = finalAesUrl.replace(/https?:\/\/[^\/]*code\.run/gi, 'https://stream.subodhpgcollege.site');
                aesKeyUrl = finalAesUrl;
                aesKeyFallbackUrl = finalAesUrl;
                
                // Force map "enc.key" to the root /hls/ directory (where PW stores it), bypassing proxy prefixes safely
                if (uriMatch[1] === "enc.key" && bestQualityUrl.includes("/hls/")) {
                    const keyUrlObj = new URL(bestQualityUrl);
                    keyUrlObj.pathname = keyUrlObj.pathname.replace(/\/hls\/[^/]+\/[^/]+$/, '/hls/enc.key');
                    aesKeyUrl = keyUrlObj.href;
                }
            }
            const ivMatch = lines[j].match(/IV=0x([0-9a-fA-F]{32})/);
            if (ivMatch) {
                explicitIv = new Uint8Array(ivMatch[1].match(/.{1,2}/g).map(byte => parseInt(byte, 16))).buffer;
            }
        } else if (lines[j].startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            mediaSequence = parseInt(lines[j].split(':')[1]);
        } else if (lines[j].startsWith('#EXTINF:')) {
            const segUrl = new URL(lines[j+1].trim(), bestQualityUrl);
            const origBest = new URL(bestQualityUrl);
            origBest.searchParams.forEach((v, k) => segUrl.searchParams.set(k, v));
            let finalSegUrl = segUrl.href;
            finalSegUrl = finalSegUrl.replace(/https?:\/\/[^\/]*code\.run/gi, 'https://stream.subodhpgcollege.site');
            segments.push(finalSegUrl);
        }
    }
    
    if (segments.length === 0) {
        throw new Error("No segments found. Content: " + mediaManifest.substring(0, 300));
    }
    
    // Step 4.3: Fetch AES Key if needed
    if (aesKeyUrl) {
        setStatus('Fetching AES decryption key...', 'active');
        let kRes = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                kRes = await fetch(aesKeyUrl);
                if (kRes.ok) break;
            } catch(e) {}
            if (attempt < 3) await new Promise(r => setTimeout(r, 600));
        }
        // Fallback: if root /hls/enc.key failed (e.g. 404), try direct relative key path
        if ((!kRes || !kRes.ok) && aesKeyFallbackUrl && aesKeyFallbackUrl !== aesKeyUrl) {
            try {
                const fbRes = await fetch(aesKeyFallbackUrl);
                if (fbRes.ok) kRes = fbRes;
            } catch(e) {}
        }
        if (!kRes || !kRes.ok) throw new Error("Failed to fetch AES key.");
        const keyData = await kRes.arrayBuffer();
        
        // Import Key into WebCrypto API
        aesKeyBuffer = await crypto.subtle.importKey(
            "raw",
            keyData,
            { name: "AES-CBC" },
            false,
            ["decrypt"]
        );
    }
    
    // Step 4.4: Prepare Native File Stream (High-Speed Engine)
    setStatus(`Downloading ${segments.length} segments (High-Speed Engine)...`, 'active');
    progWrap.style.display = 'block';
    
    // Save as .mp4 container for better cross-platform compatibility without transmuxing
    const fileHandle = await dirHandle.getFileHandle(finalFilename, { create: true });
    const writable = await fileHandle.createWritable();
    
    const CONCURRENCY = 35; // 35 parallel streams for maximum network saturation
    const downloadedMap = new Map();
    let nextWriteIndex = 0;
    let nextDownloadIndex = 0;
    let completedCount = 0;
    let totalBytesDownloaded = 0;
    let lastSpeedCalcTime = Date.now();
    let lastSpeedCalcBytes = 0;
    let currentSpeedMBs = '0.0';
    let downloadError = null;

    // High-throughput streaming disk writer: batches contiguous ready segments (up to 4MB) to minimize disk I/O overhead
    const writerPromise = (async () => {
        while (nextWriteIndex < segments.length) {
            if (downloadError) throw downloadError;

            if (downloadedMap.has(nextWriteIndex)) {
                const chunks = [];
                let batchBytes = 0;
                while (downloadedMap.has(nextWriteIndex)) {
                    const buf = downloadedMap.get(nextWriteIndex);
                    downloadedMap.delete(nextWriteIndex);
                    chunks.push(buf);
                    batchBytes += buf.byteLength;
                    nextWriteIndex++;
                    if (batchBytes >= 4 * 1024 * 1024) break; // Batch up to 4MB
                }
                if (chunks.length === 1) {
                    await writable.write(chunks[0]);
                } else if (chunks.length > 1) {
                    const combined = new Uint8Array(batchBytes);
                    let offset = 0;
                    for (const c of chunks) {
                        combined.set(new Uint8Array(c), offset);
                        offset += c.byteLength;
                    }
                    await writable.write(combined);
                }
            } else {
                await new Promise(r => setTimeout(r, 5));
            }
        }
    })();

    // Continuous worker queue: immediately takes the next segment without waiting for other workers
    const worker = async () => {
        while (nextDownloadIndex < segments.length && !downloadError) {
            // Buffer throttle: high watermark (150 segments / ~35MB) prevents worker starvation from minor network jitters
            while (downloadedMap.size > 150 && !downloadError) {
                await new Promise(r => setTimeout(r, 20));
            }

            if (nextDownloadIndex >= segments.length || downloadError) break;

            const j = nextDownloadIndex++;
            const url = segments[j];
            let segRes = null;
            let lastErr = null;

            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    segRes = await fetch(url);
                    if (segRes.ok) break;
                    lastErr = new Error(`HTTP ${segRes.status}`);
                } catch(e) {
                    lastErr = e;
                }
                if (attempt < 3) {
                    await new Promise(r => setTimeout(r, 150 * attempt));
                }
            }

            if (!segRes || !segRes.ok) {
                downloadError = new Error(`Failed to fetch segment ${j + 1} (${lastErr?.message || 'network error'})`);
                throw downloadError;
            }

            let buffer = await segRes.arrayBuffer();

            if (aesKeyBuffer) {
                let iv = explicitIv;
                if (!iv) {
                    iv = new ArrayBuffer(16);
                    const view = new DataView(iv);
                    view.setUint32(12, mediaSequence + j);
                }
                buffer = await crypto.subtle.decrypt(
                    { name: "AES-CBC", iv: iv },
                    aesKeyBuffer,
                    buffer
                );
            }

            downloadedMap.set(j, buffer);
            completedCount++;
            totalBytesDownloaded += buffer.byteLength;

            // Real-time speed calculation
            const now = Date.now();
            if (now - lastSpeedCalcTime >= 500) {
                const bytesDiff = totalBytesDownloaded - lastSpeedCalcBytes;
                const timeDiff = (now - lastSpeedCalcTime) / 1000;
                currentSpeedMBs = (bytesDiff / (1024 * 1024) / timeDiff).toFixed(1);
                lastSpeedCalcTime = now;
                lastSpeedCalcBytes = totalBytesDownloaded;
            }

            if (completedCount % 5 === 0 || completedCount === segments.length) {
                const pct = Math.round((completedCount / segments.length) * 100);
                progBar.style.width = `${pct}%`;
                const mbDownloaded = (totalBytesDownloaded / (1024 * 1024)).toFixed(1);
                statusEl.textContent = `Downloading... ${pct}% (${completedCount}/${segments.length}) • ${mbDownloaded} MB (${currentSpeedMBs} MB/s)`;
            }
        }
    };

    const workerCount = Math.min(CONCURRENCY, segments.length);
    const workers = Array.from({ length: workerCount }, () => worker());

    await Promise.all(workers);
    await writerPromise;
    await writable.close();
    
    if (window.isMobileFallback) {
        setStatus('Transferring to Downloads folder...', 'active');
        const file = await fileHandle.getFile();
        const url = URL.createObjectURL(file);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFilename;
        a.click();
        
        // Revoke after a delay to ensure download starts
        setTimeout(() => URL.revokeObjectURL(url), 15000);
    }
    
    setStatus('Saved Successfully!', 'success');
    
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  }
}
