import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Link as LinkIcon, Terminal as TerminalIcon, Info } from 'lucide-react';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('Lecture');
  const [logs, setLogs] = useState([{ time: new Date().toLocaleTimeString(), message: 'System initialized. Waiting for input...' }]);
  const [qualitiesCount, setQualitiesCount] = useState(0);
  const [qualitiesList, setQualitiesList] = useState([]);
  const [selectedQualityUrl, setSelectedQualityUrl] = useState('');
  const [segmentsCount, setSegmentsCount] = useState(0);
  const [downloadedSegmentsCount, setDownloadedSegmentsCount] = useState(0);
  const [downloadedMB, setDownloadedMB] = useState('0.00');
  const [estimatedSizeMB, setEstimatedSizeMB] = useState('N/A');
  const [sessionId, setSessionId] = useState(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);
  
  const terminalRef = useRef(null);

  const addLog = (message) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message }]);
  };

  // Auto-fill URL if opened from the browser extension (?autourl=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const autoUrl = params.get('autourl');
    const autoTitle = params.get('title');
    if (autoUrl) {
      setUrl(decodeURIComponent(autoUrl));
      if (autoTitle) setVideoTitle(decodeURIComponent(autoTitle));
      addLog('URL detected from browser extension. Click "Fetch Playlist" to continue.');
      // Clean the URL bar without reloading
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  // Handle SSE connection
  useEffect(() => {
    if (!sessionId) return;
    
    const eventSource = new EventSource(`/api/events?sessionId=${sessionId}`);
    
    eventSource.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      // Strip server timestamp to use local, or just use server's
      const msg = data.message.includes('] ') ? data.message.split('] ')[1] : data.message;
      addLog(msg);
    });

    eventSource.addEventListener('info', (e) => {
      const data = JSON.parse(e.data);
      setSegmentsCount(data.totalSegments);
    });

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      if (data.isDirectMB) {
        setDownloadedMB(data.downloadedMB);
        setEstimatedSizeMB(data.estMB);
        setDownloadedSegmentsCount(data.downloadedCount || 0);
      } else {
        const estMB = (data.downloaded * 1.5).toFixed(2);
        setDownloadedMB(estMB);
      }
    });

    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      addLog('Download ready!');
      setDownloadUrl(data.fileUrl);
      setIsDownloading(false);
      eventSource.close();
    });

    eventSource.addEventListener('error', (e) => {
      const data = JSON.parse(e.data);
      addLog(`Error: ${data.error}`);
      setIsDownloading(false);
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  const handleFetch = async () => {
    if (!url) {
      addLog('Please enter a valid M3U8 URL.');
      return;
    }
    
    setIsFetching(true);
    addLog(`Fetching playlist from URL...`);
    
    try {
      const response = await fetch(`/api/parse?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      
      if (response.ok) {
        setQualitiesCount(data.qualities.length || 1);
        setQualitiesList(data.qualities);
        if (data.qualities.length > 0) {
          setSelectedQualityUrl(data.qualities[0].url);
        } else {
          setSelectedQualityUrl(url); // fallback
        }
        addLog(`Found ${data.qualities.length || 1} qualities in the playlist.`);
      } else {
        addLog(`Error fetching playlist: ${data.error}`);
      }
    } catch (err) {
      addLog(`Failed to connect to backend: ${err.message}`);
    } finally {
      setIsFetching(false);
    }
  };

  const handleExecute = async () => {
    if (!url) {
      addLog('Please fetch a playlist first.');
      return;
    }
    
    setIsDownloading(true);
    setDownloadedMB('0.00');
    setEstimatedSizeMB('N/A');
    setSegmentsCount(0);
    setDownloadedSegmentsCount(0);
    setDownloadUrl(null);
    addLog('Starting download process...');
    
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: selectedQualityUrl || url, title: videoTitle })
      });
      
      const data = await response.json();
      if (response.ok) {
        setSessionId(data.sessionId);
        addLog('Session created. Waiting for progress...');
      } else {
        addLog(`Error starting download: ${data.error}`);
        setIsDownloading(false);
      }
    } catch (err) {
      addLog(`Failed to connect to backend: ${err.message}`);
      setIsDownloading(false);
    }
  };

  const handlePause = async () => {
    if (!sessionId) return;
    try {
      await fetch(`/api/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      setIsPaused(true);
      addLog('Sending pause command...');
    } catch (err) {
      addLog(`Failed to pause: ${err.message}`);
    }
  };

  const handleResume = async () => {
    if (!sessionId) return;
    try {
      await fetch(`/api/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      setIsPaused(false);
      addLog('Sending resume command...');
    } catch (err) {
      addLog(`Failed to resume: ${err.message}`);
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <span className="glow-title">PW Video Downloader</span>
      </header>

      <main className="main-content">
        <div className="card">
          <div className="input-group">
            <label className="input-label">
              <LinkIcon size={16} color="#8b5cf6" style={{ marginRight: '8px', verticalAlign: 'text-bottom' }} />
              Video URL
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input 
                type="text" 
                className="url-input" 
                style={{ paddingRight: '40px' }}
                placeholder="Paste here master.mpd link..."
                value={url}
                onChange={(e) => {
                  let val = e.target.value;
                  // 1. Convert .mpd to .m3u8
                  val = val.replace(/\.mpd/gi, '.m3u8');
                  // 2. Intelligently convert direct DASH .mp4 links back into the Master Playlist menu!
                  val = val.replace(/(https:\/\/[^\/]+\/[a-fA-F0-9\-]+)\/dash\/.*?\.mp4(\?.*)?/gi, '$1/master.m3u8$2');
                  setUrl(val);
                }}
                disabled={isFetching || isDownloading}
              />
              <div 
                title="Paste your .mpd or .m3u8 link here. The app will automatically convert it!"
                style={{ position: 'absolute', right: '12px', color: '#9ca3af', cursor: 'help', display: 'flex' }}
              >
                <Info size={18} />
              </div>
            </div>
          </div>

          <div className="input-group" style={{ marginTop: '10px' }}>
            <label className="input-label">
              Lecture Title
            </label>
            <input 
              type="text" 
              className="url-input" 
              placeholder="e.g. Current Electricity 01"
              value={videoTitle}
              onChange={(e) => setVideoTitle(e.target.value)}
              disabled={isDownloading}
            />
          </div>

            <button 
            className="btn-primary" 
            onClick={handleFetch}
            disabled={isFetching || isDownloading || !url}
          >
            {isFetching ? 'Fetching...' : 'Fetch Playlist'}
          </button>

          {qualitiesList.length > 1 && (
            <div className="input-group" style={{ marginTop: '15px' }}>
              <label className="input-label">Select Video Quality</label>
              <div className="quality-selector">
                {qualitiesList.map((q, idx) => {
                  const label = q.resolution && q.resolution.includes('x') 
                    ? `${q.resolution.split('x')[1]}p` 
                    : 'Auto';
                  return (
                    <button
                      key={idx}
                      className={`quality-btn ${selectedQualityUrl === q.url ? 'active' : ''}`}
                      onClick={() => setSelectedQualityUrl(q.url)}
                      disabled={isDownloading}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-value">{qualitiesCount}</span>
              <span className="stat-label">QUALITIES</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{segmentsCount}</span>
              <span className="stat-label">SEGMENTS</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{estimatedSizeMB}</span>
              <span className="stat-label">EST. SIZE</span>
            </div>
            <div className="stat-card">
              <span className="stat-value blue">{downloadedMB}</span>
              <span className="stat-label">DOWNLOADED MB</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              className="btn-success"
              style={{ 
                flex: 1,
                background: (isDownloading && !downloadUrl && segmentsCount > 0) 
                  ? `linear-gradient(90deg, #10b981 ${(downloadedSegmentsCount / segmentsCount) * 100}%, #9ca3af ${(downloadedSegmentsCount / segmentsCount) * 100}%)`
                  : undefined,
                color: (isDownloading && !downloadUrl) ? 'white' : undefined,
                transition: 'background 0.3s ease'
              }}
              onClick={downloadUrl ? () => window.location.href = downloadUrl : handleExecute}
              disabled={isDownloading || (!downloadUrl && qualitiesCount === 0)}
            >
              {downloadUrl ? 'SAVE MP4 FILE' : (isDownloading ? (isPaused ? `PAUSED (${Math.round((downloadedSegmentsCount / segmentsCount) * 100)}%)` : `DOWNLOADING... ${Math.round((downloadedSegmentsCount / segmentsCount) * 100)}%`) : 'EXECUTE DOWNLOAD')}
            </button>
            
            {isDownloading && !downloadUrl && (
              <button
                className="btn-primary"
                style={{ backgroundColor: isPaused ? '#10b981' : '#f59e0b', width: '120px' }}
                onClick={isPaused ? handleResume : handlePause}
              >
                {isPaused ? 'RESUME' : 'PAUSE'}
              </button>
            )}
          </div>

          <div className="terminal" ref={terminalRef}>
            <div className="terminal-header">
              <TerminalIcon size={14} />
              SYSTEM_LOGS
            </div>
            <div className="terminal-content">
              {logs.map((log, i) => (
                <div key={i} className="log-entry">
                  <span className="log-time">[{log.time}]</span>
                  <span className="log-icon"><Info size={14} /></span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
