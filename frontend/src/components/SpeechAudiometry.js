import React from 'react';

const SpeechAudiometry = ({ rightEarSpeech, leftEarSpeech, onUpdateSpeech }) => {
  const handleChange = (ear, field, value) => {
    const currentData = ear === 'right' ? rightEarSpeech : leftEarSpeech;
    const updated = { ...currentData, [field]: value };
    onUpdateSpeech(ear, updated);
  };

  const SpeechEarPanel = ({ ear, data }) => {
    const color = ear === 'right' ? 'red' : 'blue';
    const bgColor = ear === 'right' ? 'bg-red-50' : 'bg-blue-50';
    const textColor = ear === 'right' ? 'text-red-600' : 'text-blue-600';
    const earLabel = ear.charAt(0).toUpperCase() + ear.slice(1);

    return (
      <div className="bg-white border border-gray-300 rounded shadow-sm p-4">
        <div className={`text-center font-semibold mb-4 py-2 rounded ${bgColor} ${textColor}`}>
          {earLabel} EAR
        </div>

        <div className="space-y-4">
          {/* SRT */}
          <div className="flex items-center gap-4">
            <label className="font-semibold text-sm w-20">SRT</label>
            <input
              type="number"
              value={data?.srt || ''}
              onChange={(e) => handleChange(ear, 'srt', parseInt(e.target.value) || null)}
              placeholder="--"
              className="w-20 px-3 py-2 border border-gray-300 rounded text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">dB</span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={data?.srt_masked || false}
                onChange={(e) => handleChange(ear, 'srt_masked', e.target.checked)}
                className="w-4 h-4"
              />
              Masked
            </label>
          </div>

          {/* WDS */}
          <div className="flex items-center gap-4">
            <label className="font-semibold text-sm w-20">WDS</label>
            <input
              type="number"
              value={data?.wds_percent || ''}
              onChange={(e) => handleChange(ear, 'wds_percent', parseInt(e.target.value) || null)}
              placeholder="--"
              min="0"
              max="100"
              className="w-20 px-3 py-2 border border-gray-300 rounded text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">%</span>
            <span className="text-xs text-gray-500">@</span>
            <input
              type="number"
              value={data?.wds_presentation_level || ''}
              onChange={(e) => handleChange(ear, 'wds_presentation_level', parseInt(e.target.value) || null)}
              placeholder="--"
              className="w-16 px-2 py-2 border border-gray-300 rounded text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-600">dB</span>
          </div>

          {/* SAT */}
          <div className="flex items-center gap-4">
            <label className="font-semibold text-sm w-20">SAT</label>
            <input
              type="number"
              value={data?.sat || ''}
              onChange={(e) => handleChange(ear, 'sat', parseInt(e.target.value) || null)}
              placeholder="--"
              className="w-20 px-3 py-2 border border-gray-300 rounded text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">dB</span>
          </div>

          {/* MCL */}
          <div className="flex items-center gap-4">
            <label className="font-semibold text-sm w-20">MCL</label>
            <input
              type="number"
              value={data?.mcl || ''}
              onChange={(e) => handleChange(ear, 'mcl', parseInt(e.target.value) || null)}
              placeholder="--"
              className="w-20 px-3 py-2 border border-gray-300 rounded text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">dB</span>
          </div>

          {/* UCL */}
          <div className="flex items-center gap-4">
            <label className="font-semibold text-sm w-20">UCL</label>
            <input
              type="number"
              value={data?.ucl || ''}
              onChange={(e) => handleChange(ear, 'ucl', parseInt(e.target.value) || null)}
              placeholder="--"
              className="w-20 px-3 py-2 border border-gray-300 rounded text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">dB</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 p-4 rounded">
        <div className="font-semibold text-blue-900 mb-2">📝 Speech Audiometry</div>
        <div className="text-sm text-blue-800">
          <p className="mb-1"><strong>SRT:</strong> Speech Reception Threshold - Lowest level at which speech is recognized</p>
          <p className="mb-1"><strong>WDS:</strong> Word Discrimination Score - Percentage of words correctly identified</p>
          <p className="mb-1"><strong>SAT:</strong> Speech Awareness Threshold - Lowest level speech is detected</p>
          <p className="mb-1"><strong>MCL:</strong> Most Comfortable Level - Preferred listening level</p>
          <p><strong>UCL:</strong> Uncomfortable Loudness Level - Level at which sound becomes uncomfortably loud</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <SpeechEarPanel ear="right" data={rightEarSpeech} />
        <SpeechEarPanel ear="left" data={leftEarSpeech} />
      </div>

      {/* Validation Messages */}
      <div className="space-y-2">
        {rightEarSpeech?.srt && (
          <div className="bg-green-50 border-l-4 border-green-500 p-3 text-sm text-green-800">
            ✓ Right SRT ({rightEarSpeech.srt} dB) recorded
          </div>
        )}
        {leftEarSpeech?.srt && (
          <div className="bg-green-50 border-l-4 border-green-500 p-3 text-sm text-green-800">
            ✓ Left SRT ({leftEarSpeech.srt} dB) recorded
          </div>
        )}
      </div>
    </div>
  );
};

export default SpeechAudiometry;
