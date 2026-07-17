import React, { useState, useEffect } from 'react';
import { Search, BookOpen, ChevronRight, Loader2 } from 'lucide-react';

export default function BatchList({ onSelectBatch }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchBatches = async (pageNum, accumBatches = []) => {
    try {
      setLoading(true);
      const res = await fetch('/api/pw/v3/batches/my-batches?mode=learn&page=' + pageNum + '&filter=false');
      if (!res.ok) throw new Error('Failed to fetch batches');
      const data = await res.json();
      
      if (data && data.data) {
        const rawBatches = data.data;
        const jeeNeet = rawBatches.filter(b => {
          const n = b.name.toLowerCase();
          return n.includes('jee') || n.includes('neet');
        });
        
        const combined = [...accumBatches, ...jeeNeet];
        setBatches(combined);
        setHasMore(rawBatches.length === 20);

        // If no JEE/NEET batches were found on this page, but there are more pages, auto-fetch next page
        if (jeeNeet.length === 0 && rawBatches.length === 20 && pageNum < 10) {
          setPage(pageNum + 1);
          return fetchBatches(pageNum + 1, combined);
        }
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load batches. Make sure the backend proxy is running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches(1, []);
  }, []);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchBatches(nextPage, batches);
  };

  const filteredBatches = batches.filter(b => 
    b.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (b.class && b.class.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="batch-list-container space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Your Batches</h2>
          <p className="text-gray-400 text-sm">Explore all available courses and lectures</p>
        </div>
        
        <div className="relative w-full md:w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-gray-700 rounded-xl leading-5 bg-gray-800 text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="Search batches..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl text-center">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredBatches.map(batch => (
          <div 
            key={batch._id} 
            className="bg-gray-800/80 backdrop-blur-md border border-gray-700/50 rounded-2xl overflow-hidden hover:border-blue-500/50 transition-all duration-300 cursor-pointer group hover:-translate-y-1 shadow-lg hover:shadow-blue-500/20"
            onClick={() => onSelectBatch(batch)}
          >
            <div className="h-40 overflow-hidden relative">
              <img 
                src={batch.previewImageUrl ? (batch.previewImageUrl.startsWith('http') ? batch.previewImageUrl : 'https://static.pw.live/' + batch.previewImageUrl) : 'https://via.placeholder.com/400x225/1f2937/4b5563?text=PW+Batch'} 
                alt={batch.name}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                onError={(e) => { e.target.src = 'https://via.placeholder.com/400x225/1f2937/4b5563?text=PW+Batch' }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent opacity-80" />
              <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                 <span className="px-2.5 py-1 text-xs font-semibold bg-blue-500/80 text-white rounded-lg backdrop-blur-sm">
                   Class {batch.class || 'Unknown'}
                 </span>
                 <span className="px-2.5 py-1 text-xs font-medium bg-gray-800/80 text-gray-300 rounded-lg backdrop-blur-sm border border-gray-700">
                   {batch.language || 'Hinglish'}
                 </span>
              </div>
            </div>
            
            <div className="p-5">
              <h3 className="text-lg font-bold text-gray-100 leading-tight mb-2 line-clamp-2 group-hover:text-blue-400 transition-colors">
                {batch.name}
              </h3>
              
              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center text-sm text-gray-400">
                  <BookOpen className="w-4 h-4 mr-1.5" />
                  <span>View Details</span>
                </div>
                <div className="w-8 h-8 rounded-full bg-gray-700/50 flex items-center justify-center group-hover:bg-blue-500 transition-colors">
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-white" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {loading && (
        <div className="flex justify-center p-8">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}

      {!loading && hasMore && (
        <div className="flex justify-center mt-8">
          <button 
            onClick={loadMore}
            className="px-6 py-2.5 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-xl border border-gray-700 transition-colors"
          >
            Load More Batches
          </button>
        </div>
      )}
      
      {!loading && filteredBatches.length === 0 && (
        <div className="text-center py-12 text-gray-400 bg-gray-800/50 rounded-2xl border border-gray-700/50">
          No batches found matching your search.
        </div>
      )}
    </div>
  );
}
