import React, { useState, useEffect } from 'react';
import { ChevronLeft, PlayCircle, FileText, Download, Loader2 } from 'lucide-react';

export default function CourseView({ batch, onBack, onPlayVideo }) {
  const [subjects, setSubjects] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState(null);
  
  const [topics, setTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState(null);
  
  const [contents, setContents] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [loadingContents, setLoadingContents] = useState(false);

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/pw/v3/batches/' + batch._id + '/details');
        const data = await res.json();
        if (data && data.data && data.data.subjects) setSubjects(data.data.subjects);
      } catch (err) { console.error(err); } finally { setLoading(false); }
    };
    fetchDetails();
  }, [batch._id]);

  useEffect(() => {
    if (!selectedSubject) return;
    const fetchTopics = async () => {
      try {
        setLoadingTopics(true);
        const res = await fetch('/api/pw/v1/batches/' + batch._id + '/subject/' + selectedSubject._id + '/topics?page=1');
        const data = await res.json();
        if (data && data.data) setTopics(data.data);
      } catch (err) { console.error(err); } finally { setLoadingTopics(false); }
    };
    fetchTopics();
  }, [selectedSubject, batch._id]);

  useEffect(() => {
    if (!selectedSubject) return;
    const fetchContents = async () => {
      try {
        setLoadingContents(true);
        const topicFilter = selectedTopic ? '&topicId=' + selectedTopic._id : '';
        const res = await fetch('/api/pw/v2/batches/' + batch._id + '/subject/' + selectedSubject._id + '/contents?page=1&contentType=exercises-notes-video-videos-peertopeer-mcq-subjects-pdf-dpp-html' + topicFilter);
        const data = await res.json();
        if (data && data.data) setContents(data.data);
      } catch (err) { console.error(err); } finally { setLoadingContents(false); }
    };
    fetchContents();
  }, [selectedSubject, selectedTopic, batch._id]);

  return (
    <div className="course-view space-y-6">
      <button onClick={onBack} className="flex items-center text-gray-400 hover:text-white transition-colors">
        <ChevronLeft className="w-5 h-5 mr-1" /> Back to Batches
      </button>

      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6">
        <h2 className="text-3xl font-bold text-white mb-2">{batch.name}</h2>
        <p className="text-gray-400">Class {batch.class} • {batch.language}</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-1/3 space-y-6">
          <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Subjects</h3>
            {loading ? <Loader2 className="w-6 h-6 text-blue-500 animate-spin mx-auto" /> : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {subjects.map(sub => (
                  <button key={sub._id} onClick={() => { setSelectedSubject(sub); setSelectedTopic(null); }} className={"w-full text-left px-4 py-3 rounded-xl transition-all "}>
                    {sub.subject}
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedSubject && (
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-4">
              <h3 className="text-lg font-semibold text-white mb-4">Chapters</h3>
              {loadingTopics ? <Loader2 className="w-6 h-6 text-blue-500 animate-spin mx-auto" /> : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                  <button onClick={() => setSelectedTopic(null)} className={"w-full text-left px-4 py-3 rounded-xl transition-all "}>All Chapters</button>
                  {topics.map(topic => (
                    <button key={topic._id} onClick={() => setSelectedTopic(topic)} className={"w-full text-left px-4 py-3 rounded-xl transition-all "}>
                      {topic.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="lg:w-2/3">
          <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6 min-h-[500px]">
            <h3 className="text-xl font-semibold text-white mb-6">
              {selectedTopic ? selectedTopic.name : (selectedSubject ? selectedSubject.subject : 'Select a subject')}
            </h3>
            {!selectedSubject ? <div className="flex justify-center h-64 text-gray-500">Please select a subject to view lectures.</div> : loadingContents ? <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mt-20" /> : (
              <div className="space-y-4">
                {contents.length === 0 ? <div className="text-center py-12 text-gray-500">No lectures found.</div> : contents.map(content => (
                  <div key={content._id} className="bg-gray-900/50 border border-gray-700/50 p-4 rounded-xl flex items-center justify-between group hover:border-blue-500/50 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-gray-800 flex items-center justify-center text-blue-400">
                        {content.contentType === 'video' || content.contentType === 'videos' ? <PlayCircle /> : <FileText />}
                      </div>
                      <div>
                        <h4 className="text-gray-200 font-medium">{content.name || content.topic}</h4>
                        <p className="text-xs text-gray-500 mt-1">{new Date(content.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {(content.contentType === 'video' || content.contentType === 'videos') && content.url && (
                        <button onClick={() => onPlayVideo(content.url)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2">
                          <PlayCircle className="w-4 h-4" /> Play
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
