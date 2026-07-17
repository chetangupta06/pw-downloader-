import { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, Layout, MonitorPlay, Settings, Download as DownloadIcon } from 'lucide-react';
import BatchList from './components/BatchList';
import CourseView from './components/CourseView';
import VideoPlayer from './components/VideoPlayer';
import './App.css';

function DownloaderTool({ 
  url, setUrl, logs, terminalRef, qualitiesCount, qualitiesList, 
  selectedQualityUrl, segmentsCount, downloadedSegmentsCount, 
  downloadedMB, estimatedSizeMB, sessionId, isFetching, 
  isDownloading, isPaused, downloadUrl, handleFetch, handleDownload, 
  handlePause, handleResume 
}) {
  return (
    <div className="flex-1 p-6 md:p-8 lg:p-12 overflow-y-auto custom-scrollbar flex items-center justify-center">
      <div className="max-w-4xl w-full mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-blue-500/10 rounded-2xl mb-4">
            <MonitorPlay className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4 tracking-tight">
            PW Lecture <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">Downloader</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Download your Physics Wallah lectures seamlessly with automated Widevine DRM bypass. 
          </p>
        </div>
        <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl p-6 md:p-8 shadow-2xl border border-gray-700/50">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Playlist URL (.m3u8 / .mpd)</label>
              <div className="relative">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://...master.m3u8"
                  className="w-full bg-gray-900/50 border border-gray-700 rounded-xl px-4 py-3.5 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            <button
              onClick={handleFetch}
              disabled={isFetching || !url}
              className={`w-full py-3.5 px-4 rounded-xl font-bold text-white transition-all shadow-lg hover:shadow-blue-500/25 ${
                isFetching || !url
                  ? 'bg-blue-600/50 cursor-not-allowed text-white/50'
                  : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 active:scale-[0.98]'
              }`}
            >
              {isFetching ? 'Fetching Manifest...' : 'Fetch Video Qualities'}
            </button>

            {qualitiesCount > 0 && (
              <div className="pt-4 space-y-4 border-t border-gray-700/50 animate-fade-in">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    Available Qualities <span className="bg-blue-500/20 text-blue-400 text-xs px-2.5 py-1 rounded-full">{qualitiesCount}</span>
                  </h3>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {qualitiesList.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleDownload(q.url)}
                      disabled={isDownloading}
                      className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                        isDownloading 
                          ? 'border-gray-700 bg-gray-800/50 cursor-not-allowed opacity-50'
                          : 'border-gray-700 bg-gray-800 hover:border-blue-500/50 hover:bg-gray-700/50 group'
                      }`}
                    >
                      <div className="flex flex-col items-start">
                        <span className="font-semibold text-gray-200 group-hover:text-blue-400 transition-colors">{q.resolution}</span>
                        <span className="text-xs text-gray-500">Bandwidth: {q.bandwidth}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isDownloading && (
              <div className="pt-4 space-y-4 border-t border-gray-700/50 animate-fade-in">
                <div className="flex justify-between items-center text-sm text-gray-400 mb-2">
                  <span>Downloading Video...</span>
                  <span className="text-blue-400 font-mono">
                    {segmentsCount > 0 ? `${Math.round((downloadedSegmentsCount / segmentsCount) * 100)}%` : '0%'}
                  </span>
                </div>
                
                <div className="w-full bg-gray-900 rounded-full h-3 mb-4 overflow-hidden border border-gray-800">
                  <div 
                    className="bg-blue-500 h-3 rounded-full transition-all duration-300 relative overflow-hidden" 
                    style={{ width: segmentsCount > 0 ? `${(downloadedSegmentsCount / segmentsCount) * 100}%` : '0%' }}
                  >
                  </div>
                </div>
                
                <div className="flex justify-between items-center text-xs text-gray-500 font-mono">
                  <span>{downloadedMB} MB downloaded</span>
                  <span>Est. Size: {estimatedSizeMB} MB</span>
                </div>
              </div>
            )}

            {downloadUrl && (
              <div className="pt-6 animate-fade-in">
                <a 
                  href={downloadUrl}
                  className="flex items-center justify-center gap-2 w-full py-4 px-4 rounded-xl font-bold text-white bg-green-600 hover:bg-green-500 transition-all shadow-lg hover:shadow-green-500/25"
                >
                  Save MP4 File
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('browse');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [playingVideoUrl, setPlayingVideoUrl] = useState(null);

  const [url, setUrl] = useState('');
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

  const addLog = (message) => setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message }]);

  useEffect(() => {
    if (!sessionId) return;
    const eventSource = new EventSource('/api/events?sessionId=' + sessionId);
    
    eventSource.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      addLog(data.message.split('] ')[1] || data.message);
    });
    eventSource.addEventListener('info', (e) => {
      const data = JSON.parse(e.data);
      if (data.totalSegments) setSegmentsCount(data.totalSegments);
    });
    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      setDownloadedSegmentsCount(data.downloadedCount || data.downloaded || 0);
      if (data.downloadedMB) setDownloadedMB(data.downloadedMB);
      if (data.estMB) setEstimatedSizeMB(data.estMB);
    });
    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      addLog('Process complete! Ready for download.');
      setIsDownloading(false);
      setIsPaused(false);
      setDownloadUrl(data.fileUrl);
      eventSource.close();
    });
    eventSource.addEventListener('error', (e) => {
      const data = JSON.parse(e.data);
      addLog('ERROR: ' + data.error);
      setIsDownloading(false);
      eventSource.close();
    });
    return () => eventSource.close();
  }, [sessionId]);

  const handleFetch = async () => {
    try {
      setIsFetching(true);
      setQualitiesCount(0);
      setQualitiesList([]);
      setDownloadUrl(null);
      setSessionId(null);
      const res = await fetch('/api/parse?url=' + encodeURIComponent(url));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQualitiesCount(data.qualities.length);
      setQualitiesList(data.qualities);
    } catch (err) {
      addLog('ERROR: ' + err.message);
    } finally {
      setIsFetching(false);
    }
  };

  const handleDownload = async (targetUrl) => {
    try {
      setIsDownloading(true);
      setDownloadedSegmentsCount(0);
      setDownloadUrl(null);
      setSelectedQualityUrl(targetUrl);
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSessionId(data.sessionId);
    } catch (err) {
      addLog('ERROR: ' + err.message);
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-200 flex">
      <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col hidden md:flex">
        <div className="h-20 flex items-center px-6 border-b border-gray-800">
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">Study Portal</h1>
        </div>
        <div className="flex-1 py-6 px-4 space-y-2">
          <button onClick={() => { setActiveTab('browse'); setPlayingVideoUrl(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${activeTab === 'browse' ? 'bg-blue-600/10 text-blue-400' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}>
            <Layout className="w-5 h-5" /> Browse Batches
          </button>
          <button onClick={() => setActiveTab('downloader')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${activeTab === 'downloader' ? 'bg-blue-600/10 text-blue-400' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}>
            <DownloadIcon className="w-5 h-5" /> Downloader Tool
          </button>
        </div>
      </div>
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {activeTab === 'browse' ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8 lg:p-10">
            <div className="max-w-7xl mx-auto">
              {playingVideoUrl ? (
                <VideoPlayer url={playingVideoUrl} onBack={() => setPlayingVideoUrl(null)} onDownload={(u) => { setUrl(u); setActiveTab('downloader'); handleFetch(); }} />
              ) : selectedBatch ? (
                <CourseView batch={selectedBatch} onBack={() => setSelectedBatch(null)} onPlayVideo={setPlayingVideoUrl} />
              ) : (
                <BatchList onSelectBatch={setSelectedBatch} />
              )}
            </div>
          </div>
        ) : (
          <DownloaderTool url={url} setUrl={setUrl} logs={logs} terminalRef={terminalRef} qualitiesCount={qualitiesCount} qualitiesList={qualitiesList} selectedQualityUrl={selectedQualityUrl} segmentsCount={segmentsCount} downloadedSegmentsCount={downloadedSegmentsCount} downloadedMB={downloadedMB} estimatedSizeMB={estimatedSizeMB} sessionId={sessionId} isFetching={isFetching} isDownloading={isDownloading} isPaused={isPaused} downloadUrl={downloadUrl} handleFetch={handleFetch} handleDownload={handleDownload} handlePause={()=>{}} handleResume={()=>{}} />
        )}
      </div>
    </div>
  );
}
export default App;
