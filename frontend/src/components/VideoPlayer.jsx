import React, { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { ChevronLeft, Download } from 'lucide-react';

export default function VideoPlayer({ url, title, onBack, onDownload }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (!url || !videoRef.current) return;

    const video = videoRef.current;
    let hls;

    if (Hls.isSupported()) {
      hls = new Hls({
        maxMaxBufferLength: 60,
        enableWorker: true
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(e => console.log('Autoplay prevented', e));
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // For Safari
      video.src = url;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(e => console.log('Autoplay prevented', e));
      });
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [url]);

  return (
    <div className="video-player-container space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center text-gray-400 hover:text-white transition-colors">
          <ChevronLeft className="w-5 h-5 mr-1" /> Back to Lectures
        </button>
        <button onClick={() => onDownload(url)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/20">
          <Download className="w-4 h-4" /> Download Quality
        </button>
      </div>

      <div className="bg-black rounded-2xl overflow-hidden shadow-2xl border border-gray-800">
        <video 
          ref={videoRef}
          controls
          className="w-full aspect-video"
          crossOrigin="anonymous"
        />
      </div>

      <div className="p-6 bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl">
        <h2 className="text-2xl font-bold text-white">{title || 'Playing Lecture'}</h2>
        <p className="text-gray-400 mt-2">
          To download this lecture at maximum speed with DRM bypass, click the Download button above. This will send it directly to your downloader engine.
        </p>
      </div>
    </div>
  );
}
