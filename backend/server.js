const express = require('express');
const cors = require('cors');
const axios = require('axios');
const m3u8Parser = require('m3u8-parser');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const axiosInstance = axios.create({
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 300 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 300 }),
});

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files for Monorepo deployment
app.use(express.static(path.join(__dirname, '../frontend/dist')));

const activeSessions = new Map();

// Ensure temp directory exists
const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR);
}

// Ensure output directory exists
const OUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR);
}

const sendEvent = (session, type, data) => {
  if (session.res) {
    session.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }
};

const log = (session, message) => {
  const timestamp = new Date().toISOString().split('T')[1].substring(0, 12);
  const formattedMessage = `[${timestamp}] ${message}`;
  console.log(formattedMessage);
  sendEvent(session, 'log', { message: formattedMessage });
};

// Helper to preserve query parameters
const resolveUrl = (relative, base) => {
    // FIX for Heroku player returning URLs without https://
    if (relative && !relative.startsWith('http') && (relative.includes('.cloudfront.net') || relative.includes('.penpencil.co') || relative.includes('.pw.live') || relative.includes('.testwave.cc'))) {
        relative = 'https://' + relative;
    }
    
    const baseUrlObj = new URL(base);
    const resolved = new URL(relative, base);
    for (const [key, value] of baseUrlObj.searchParams.entries()) {
        if (!resolved.searchParams.has(key)) {
            resolved.searchParams.set(key, value);
        }
    }
    return resolved.href;
};

app.get('/api/parse', async (req, res) => {
  let { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // AUTOMATIC DRM BYPASS: Convert DASH (.mpd) to HLS (.m3u8)
  if (url.includes('.mpd')) {
      url = url.replace('.mpd', '.m3u8');
  }

  // BYPASS CLOUDFLARE: If the URL uses proxy.pwthor.live, strip it and use direct Cloudfront URL
  if (url.includes('proxy.pwthor.live/play/')) {
      url = 'https://' + url.split('proxy.pwthor.live/play/')[1];
  }

  try {
    const urlObj = new URL(url);
    if (urlObj.pathname.match(/\/(\d+)\.mp4$/)) {
      return res.json({
        qualities: [{
          resolution: 'Sequential DASH (Multiple Parts)',
          bandwidth: 'Unknown',
          url: url
        }],
        isSequentialDash: true
      });
    }

    const response = await axios.get(url);
    const parser = new m3u8Parser.Parser();
    parser.push(response.data);
    parser.end();

    const manifest = parser.manifest;
    let qualities = [];

    if (manifest.playlists && manifest.playlists.length > 0) {
      // It's a master playlist
      qualities = manifest.playlists.map(p => ({
        resolution: p.attributes.RESOLUTION ? `${p.attributes.RESOLUTION.width}x${p.attributes.RESOLUTION.height}` : 'Unknown',
        bandwidth: p.attributes.BANDWIDTH,
        url: resolveUrl(p.uri, url)
      }));
    } else if (manifest.segments && manifest.segments.length > 0) {
      // It's already a media playlist
      qualities = [{
        resolution: 'Default',
        bandwidth: 'Unknown',
        url: url
      }];
    }

    res.json({ qualities, manifest });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch or parse URL' });
  }
});

app.post('/api/download', async (req, res) => {
  let { url } = req.body;
  
  // AUTOMATIC DRM BYPASS: Convert DASH (.mpd) to HLS (.m3u8)
  if (url && url.includes('.mpd')) {
      url = url.replace('.mpd', '.m3u8');
  }

  const sessionId = Date.now().toString();

  const session = {
    id: sessionId,
    res: null, // For SSE connection
    url: url,
    status: 'downloading'
  };
  activeSessions.set(sessionId, session);

  res.json({ sessionId });

  // Start background process
  processDownload(sessionId, url).catch(err => {
    log(session, `ERROR: ${err.message}`);
    sendEvent(session, 'error', { error: err.message });
  });
});

app.get('/api/events', (req, res) => {
  const { sessionId } = req.query;
  const session = activeSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  session.res = res;
  
  req.on('close', () => {
    session.res = null;
  });
});

app.post('/api/pause', (req, res) => {
    const { sessionId } = req.body;
    const session = activeSessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    session.status = 'paused';
    log(session, 'Download paused by user.');
    res.json({ success: true });
});

app.post('/api/resume', (req, res) => {
    const { sessionId } = req.body;
    const session = activeSessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    session.status = 'downloading';
    log(session, 'Download resumed.');
    res.json({ success: true });
});

async function processDownload(sessionId, m3u8Url) {
  const session = activeSessions.get(sessionId);
  
  // Wait up to 5 seconds for the frontend to connect via SSE before starting
  let attempts = 0;
  while (!session.res && attempts < 50) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
  }

  log(session, `Starting download process for: ${m3u8Url}`);
  
  const urlObj = new URL(m3u8Url);
  const match = urlObj.pathname.match(/\/(\d+)\.mp4$/);
  
  if (match) {
     log(session, `Sequential DASH stream detected. Starting brute-force download...`);
     
     const sessionDir = path.join(TMP_DIR, sessionId);
     fs.mkdirSync(sessionDir);
     const listFilePath = path.join(sessionDir, 'list.txt');
     let listFileContent = '';
     
     let downloadedCount = 0;
     let consecutiveErrors = 0;
     
     // Start from segment 1, or whatever number was in the URL
     const startNum = parseInt(match[1], 10);
     let i = startNum;

     // Attempt to download the initialization segment first!
     log(session, `Attempting to fetch DASH initialization segment...`);
     const initNames = ['init.mp4', '0.mp4'];
     for (const initName of initNames) {
         try {
             const newPath = urlObj.pathname.replace(/\/(\d+)\.mp4$/, `/${initName}`);
             const initUrl = urlObj.origin + newPath + urlObj.search;
             const initPath = path.join(sessionDir, `seg_init.mp4`);
             
             const initRes = await axiosInstance({
                 url: initUrl,
                 method: 'GET',
                 responseType: 'stream',
                 timeout: 10000
             });
             
             const writer = fs.createWriteStream(initPath);
             initRes.data.pipe(writer);
             
             await new Promise((resolve, reject) => {
                 writer.on('finish', resolve);
                 writer.on('error', reject);
             });
             
             log(session, `Successfully downloaded initialization segment (${initName}).`);
             break;
         } catch (e) {
             // Just continue checking the next name
         }
     }
     
     let currentIndex = startNum;
     let maxSuccessfulIndex = startNum - 1;
     let hasHitEnd = false;
     let consecutiveNotFound = 0;
     const CONCURRENCY = 150;

     const worker = async () => {
         while (!hasHitEnd && consecutiveNotFound < 3) {
             const currentI = currentIndex++;
             const newPath = urlObj.pathname.replace(/\/(\d+)\.mp4$/, `/${currentI}.mp4`);
             const segmentUrl = urlObj.origin + newPath + urlObj.search;
             const segmentPath = path.join(sessionDir, `seg_${currentI}.mp4`);
             
             try {
                 const segRes = await axiosInstance({
                     url: segmentUrl,
                     method: 'GET',
                     responseType: 'stream',
                     timeout: 10000
                 });
                 
                 const writer = fs.createWriteStream(segmentPath);
                 segRes.data.pipe(writer);
                 
                 await new Promise((resolve, reject) => {
                     writer.on('finish', resolve);
                     writer.on('error', reject);
                 });
                 
                 downloadedCount++;
                 maxSuccessfulIndex = Math.max(maxSuccessfulIndex, currentI);
                 consecutiveNotFound = 0; // reset
                 
                 if (downloadedCount % 20 === 0) {
                     log(session, `Downloaded ${downloadedCount} segments so far...`);
                     sendEvent(session, 'progress', { downloaded: downloadedCount, total: '?', isDirectMB: false });
                 }
             } catch (error) {
                 if (error.response && (error.response.status === 403 || error.response.status === 404)) {
                     consecutiveNotFound++;
                     if (consecutiveNotFound >= 3) {
                         hasHitEnd = true;
                         log(session, `Hit end of stream near segment ${currentI}.`);
                     }
                 } else {
                     consecutiveNotFound++;
                 }
             }
         }
     };

     const workers = [];
     for (let w = 0; w < CONCURRENCY; w++) {
         workers.push(worker());
     }
     await Promise.all(workers);
     
     // Update i so the merge loop knows where to stop
     i = maxSuccessfulIndex + 1;
     
     log(session, `Total ${downloadedCount} segments downloaded. Merging files...`);
     
     const outputPath = path.join(OUT_DIR, `${sessionId}.mp4`);
     
     try {
       const finalStream = fs.createWriteStream(outputPath);
       
       const initPath = path.join(sessionDir, `seg_init.mp4`);
       if (fs.existsSync(initPath)) {
           const initData = await fs.promises.readFile(initPath);
           const canWrite = finalStream.write(initData);
           if (!canWrite) await new Promise(r => finalStream.once('drain', r));
       }
       
       for (let j = startNum; j < i; j++) {
          const segmentPath = path.join(sessionDir, `seg_${j}.mp4`);
          if (fs.existsSync(segmentPath)) {
             const data = await fs.promises.readFile(segmentPath);
             const canWrite = finalStream.write(data);
             if (!canWrite) await new Promise(r => finalStream.once('drain', r));
          }
       }
       finalStream.end();
       
       await new Promise((resolve, reject) => {
           finalStream.on('finish', resolve);
           finalStream.on('error', reject);
       });
       
       log(session, 'Merge completed successfully.');
       sendEvent(session, 'complete', { fileUrl: `/api/download_file?sessionId=${sessionId}` });
       fs.rmSync(sessionDir, { recursive: true, force: true });
     } catch (err) {
       throw new Error(`Merge failed: ${err.message}`);
     }
     return;
  }

  // Fallback to standard M3U8 process
  let response = await axios.get(m3u8Url);
  let parser = new m3u8Parser.Parser();
  parser.push(response.data);
  parser.end();
  let manifest = parser.manifest;

  if (manifest.playlists && manifest.playlists.length > 0) {
      log(session, 'Master playlist detected. Selecting best quality...');
      manifest.playlists.sort((a, b) => (b.attributes.BANDWIDTH || 0) - (a.attributes.BANDWIDTH || 0));
      const bestQualityUrl = resolveUrl(manifest.playlists[0].uri, m3u8Url);
      
      log(session, `Fetching segments for best quality...`);
      response = await axios.get(bestQualityUrl);
      parser = new m3u8Parser.Parser();
      parser.push(response.data);
      parser.end();
      manifest = parser.manifest;
      
      // Update base URL for relative segment paths
      m3u8Url = bestQualityUrl;
  }

  if (!manifest.segments || manifest.segments.length === 0) {
    throw new Error('No segments found in the playlist. Make sure you select a specific quality/media playlist, not a master playlist.');
  }

  const totalSegments = manifest.segments.length;
  log(session, `Found ${totalSegments} segments.`);
  sendEvent(session, 'info', { totalSegments });

  // Check for AES-128 Encryption
  let aesKeyBuffer = null;
  const firstSeg = manifest.segments[0];
  if (firstSeg && firstSeg.key && firstSeg.key.method === 'AES-128') {
      log(session, 'AES-128 Encryption detected. Fetching decryption key...');
      let keyUrl = firstSeg.key.uri;
      
      // If URI doesn't include domain, resolve it
      if (!keyUrl.startsWith('http')) {
          keyUrl = resolveUrl(keyUrl, m3u8Url);
      }
      
      // MAGIC BYPASS / FIX: The AES key is always hosted at the root /hls/enc.key on the CDN.
      // Sometimes PW claims it's on api.penpencil.co (which requires an Auth token).
      // Sometimes PW provides a relative path like /hls/720/enc.key (which returns 403 Forbidden).
      // We ignore both and forcefully construct the true root CDN path!
      const m3u8UrlObj = new URL(m3u8Url);
      const match = m3u8UrlObj.pathname.match(/^\/([^\/]+)\//);
      if (match) {
          const videoId = match[1]; 
          keyUrl = `${m3u8UrlObj.origin}/${videoId}/hls/enc.key${m3u8UrlObj.search}`;
          log(session, 'Forcefully remapped AES Key URL to root HLS directory on CDN.');
      }
      
      try {
          const keyRes = await axios.get(keyUrl, {
              responseType: 'arraybuffer'
          });
          aesKeyBuffer = Buffer.from(keyRes.data);
          log(session, 'Successfully fetched decryption key from CDN.');
      } catch (e) {
          throw new Error('Failed to fetch decryption key. ' + (e.response ? e.response.status : e.message));
      }
  }

  const sessionDir = path.join(TMP_DIR, sessionId);
  fs.mkdirSync(sessionDir);
  const listFilePath = path.join(sessionDir, 'list.txt');
  let listFileContent = '';

  let downloadedCount = 0;
  let downloadedBytes = 0;
  
  let currentIndex = 0;
  const CONCURRENCY_LIMIT = 150;
  let hasError = false;

  const worker = async () => {
      while (currentIndex < totalSegments && !hasError) {
          // Check pause status
          while (session.status === 'paused') {
              await new Promise(resolve => setTimeout(resolve, 500));
          }

          if (hasError) break;

          const i = currentIndex++;
          const segment = manifest.segments[i];
          const segmentUrl = resolveUrl(segment.uri, m3u8Url);
          const segmentPath = path.join(sessionDir, `seg_${i}.ts`);
          
          try {
              const segRes = await axiosInstance({
                  url: segmentUrl,
                  method: 'GET',
                  responseType: 'stream',
              });

              const writer = fs.createWriteStream(segmentPath);
              
              if (aesKeyBuffer) {
                  // HLS Spec: IV is either provided or is the segment sequence number
                  let ivBuffer;
                  if (segment.key && segment.key.iv) {
                      ivBuffer = Buffer.alloc(16);
                      for (let k = 0; k < 4; k++) {
                          ivBuffer.writeUInt32BE(segment.key.iv[k] || 0, k * 4);
                      }
                  } else {
                      const seqNum = manifest.mediaSequence + i;
                      ivBuffer = Buffer.alloc(16);
                      ivBuffer.writeUInt32BE(seqNum, 12);
                  }
                  
                  const decipher = crypto.createDecipheriv('aes-128-cbc', aesKeyBuffer, ivBuffer);
                  segRes.data.pipe(decipher).pipe(writer);
              } else {
                  segRes.data.pipe(writer);
              }
              
              await new Promise((resolve, reject) => {
                  writer.on('finish', resolve);
                  writer.on('error', reject);
              });

              const stat = fs.statSync(segmentPath);
              downloadedBytes += stat.size;
              downloadedCount++;
              
              if (downloadedCount % 10 === 0 || downloadedCount === totalSegments) {
                  log(session, `Downloaded ${downloadedCount}/${totalSegments} segments...`);
                  const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
                  const estMB = ((downloadedBytes / downloadedCount) * totalSegments / (1024 * 1024)).toFixed(2);
                  sendEvent(session, 'progress', { downloadedCount, totalSegments, downloadedMB, estMB, isDirectMB: true });
              }
          } catch (err) {
              log(session, `Error downloading segment ${i}: ${err.message}`);
              hasError = true;
              throw err;
          }
      }
  };

  // Launch workers
  const workers = Array(CONCURRENCY_LIMIT).fill(null).map(() => worker());
  await Promise.all(workers);

  if (hasError) {
      throw new Error('Download failed due to segment error.');
  }

  // Generate list file for native merge
  for (let i = 0; i < totalSegments; i++) {
      listFileContent += `file 'seg_${i}.ts'\n`;
  }

  log(session, 'All segments downloaded. Piping directly to FFmpeg (Zero quality loss)...');

  const outputMp4Path = path.join(OUT_DIR, `${sessionId}.mp4`);
  
  try {
    const ffmpeg = spawn('ffmpeg', [
        '-y', // Overwrite output files without asking
        '-i', 'pipe:0', // Read from standard input
        '-c', 'copy', // Copy streams exactly without re-encoding
        outputMp4Path
    ]);
    
    // We don't want the server to crash if ffmpeg throws a generic warning
    ffmpeg.stdin.on('error', (err) => {
        // Ignored, handled by close event
    });

    for (let j = 0; j < totalSegments; j++) {
       const segmentPath = path.join(sessionDir, `seg_${j}.ts`);
       if (fs.existsSync(segmentPath)) {
           const data = await fs.promises.readFile(segmentPath);
           const canWrite = ffmpeg.stdin.write(data);
           if (!canWrite) await new Promise(r => ffmpeg.stdin.once('drain', r));
       }
    }
    
    // Close the pipe to tell ffmpeg we are done sending data
    ffmpeg.stdin.end();
    
    await new Promise((resolve, reject) => {
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                log(session, 'MP4 Remux successful! Ready to save.');
                sendEvent(session, 'complete', { fileUrl: `/api/download_file?sessionId=${sessionId}&format=mp4` });
                try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) {}
                resolve();
            } else {
                log(session, `MP4 Remux failed (Code ${code}). Check logs.`);
                sendEvent(session, 'error', { error: 'FFmpeg processing failed' });
                try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) {}
                reject(new Error('FFmpeg failed'));
            }
        });
        
        ffmpeg.on('error', (err) => {
            log(session, `FFmpeg error: ${err.message}`);
            sendEvent(session, 'error', { error: 'FFmpeg processing failed' });
            try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) {}
            reject(err);
        });
    });
  } catch (err) {
    throw new Error(`Direct Merge/Remux failed: ${err.message}`);
  }
}

app.get('/api/download_file', (req, res) => {
  const { sessionId, format = 'ts' } = req.query;
  const filePath = path.join(OUT_DIR, `${sessionId}.${format}`);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath, `lecture.${format}`);
  } else {
    res.status(404).send('File not found');
  }
});

// Catch-all route to serve the React frontend
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// --- Telegram Bot Integration (Disabled due to regional ban / IP blocks) ---
/*
const TelegramBot = require('node-telegram-bot-api');
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
try {
  if (telegramToken) {
    const bot = new TelegramBot(telegramToken, { polling: { interval: 3000 } });
    bot.on('polling_error', (err) => console.log('Telegram polling issue:', err.code));
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, 'Welcome to PW Downloader! Click the button below to start downloading your lectures.', {
        reply_markup: {
          inline_keyboard: [[
            {
              text: 'Open Downloader 🚀',
              web_app: { url: 'https://chetangupta06-pw-downloader.hf.space' }
            }
          ]]
        }
      });
    });
    console.log('Telegram Bot is active...');
  } else {
    console.log('TELEGRAM_BOT_TOKEN is not set. Telegram bot is disabled.');
  }
} catch(e) {
  console.log('Failed to start Telegram Bot:', e.message);
}
*/
// --------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT} at 0.0.0.0`);
});
