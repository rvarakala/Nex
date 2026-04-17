import React from 'react';

const ResultsPanel = ({ 
  rightEarResults, 
  leftEarResults, 
  onUpdateResults,
  clinicalImpression,
  onClinicalImpressionChange,
  recommendations,
  onRecommendationsChange
}) => {
  const degreeOptions = ['normal', 'slight', 'mild', 'moderate', 'moderately_severe', 'severe', 'profound'];
  const typeOptions = ['normal', 'conductive', 'sensorineural', 'mixed'];
  const configOptions = ['flat', 'sloping', 'rising', 'notch', 'u_shape', 'high_freq', 'low_freq'];
  
  const recommendationOptions = [
    'Annual Hearing Assessment',
    'Hearing Aid Evaluation',
    'Balance Assessment',
    'Auditory Brainstem Response (ABR)',
    'Tinnitus Assessment & Management',
    'Speech Evaluation',
    'ENT Specialist Consult',
    'Follow-up in 3 months',
    'Follow-up in 6 months',
  ];

  const handleResultChange = (ear, field, value) => {
    onUpdateResults(ear, { ...ear === 'right' ? rightEarResults : leftEarResults, [field]: value });
  };

  const toggleRecommendation = (rec) => {
    if (recommendations.includes(rec)) {
      onRecommendationsChange(recommendations.filter(r => r !== rec));
    } else {
      onRecommendationsChange([...recommendations, rec]);
    }
  };

  const EarResultsPanel = ({ ear, results }) => {
    const color = ear === 'right' ? 'red' : 'blue';
    const bgColor = ear === 'right' ? 'bg-red-50' : 'bg-blue-50';
    const textColor = ear === 'right' ? 'text-red-600' : 'text-blue-600';
    const earLabel = ear.charAt(0).toUpperCase() + ear.slice(1);

    return (
      <div className="bg-white border border-gray-300 rounded shadow-sm p-4">
        <div className={`text-center font-semibold mb-4 py-2 rounded ${bgColor} ${textColor}`}>
          {earLabel} EAR
        </div>

        {/* Audiogram Classification */}
        <div className="mb-4">
          <div className="text-sm font-semibold mb-2">Audiogram Classification</div>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input
              type="checkbox"
              checked={results?.degree === 'normal'}
              onChange={(e) => handleResultChange(ear, 'degree', e.target.checked ? 'normal' : null)}
              className="w-4 h-4"
            />
            Audiogram within normal limits (WNL)
          </label>
        </div>

        {/* Degree */}
        <div className="mb-4">
          <div className="text-sm font-semibold mb-2">Degree of Hearing Loss</div>
          <div className="space-y-1.5">
            {degreeOptions.map(option => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${ear}-degree`}
                  checked={results?.degree === option}
                  onChange={() => handleResultChange(ear, 'degree', option)}
                  className="w-4 h-4"
                />
                <span className="capitalize">{option.replace('_', ' ')}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Type */}
        <div className="mb-4">
          <div className="text-sm font-semibold mb-2">Type</div>
          <div className="space-y-1.5">
            {typeOptions.map(option => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${ear}-type`}
                  checked={results?.type === option}
                  onChange={() => handleResultChange(ear, 'type', option)}
                  className="w-4 h-4"
                />
                <span className="capitalize">{option}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Configuration */}
        <div className="mb-4">
          <div className="text-sm font-semibold mb-2">Configuration</div>
          <div className="space-y-1.5">
            {configOptions.map(option => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${ear}-config`}
                  checked={results?.config === option}
                  onChange={() => handleResultChange(ear, 'config', option)}
                  className="w-4 h-4"
                />
                <span className="capitalize">{option.replace('_', ' ')}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Results Interpretation */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Results Interpretation</h2>
        <div className="grid grid-cols-2 gap-6">
          <EarResultsPanel ear="right" results={rightEarResults} />
          <EarResultsPanel ear="left" results={leftEarResults} />
        </div>
      </div>

      {/* Clinical Impression */}
      <div className="bg-white border border-gray-300 rounded shadow-sm p-4">
        <h3 className="text-base font-semibold mb-3">Clinical Impression</h3>
        <textarea
          value={clinicalImpression}
          onChange={(e) => onClinicalImpressionChange(e.target.value)}
          placeholder="Enter clinical impressions, narrative findings, and assessment..."
          className="w-full min-h-32 p-3 border border-gray-300 rounded text-sm resize-vertical focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="mt-2 text-xs text-gray-500">
          💡 Describe the audiometric findings, their clinical significance, and recommendations for management.
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-white border border-gray-300 rounded shadow-sm p-4">
        <h3 className="text-base font-semibold mb-3">Recommendations</h3>
        <div className="grid grid-cols-2 gap-3">
          {recommendationOptions.map(option => (
            <label key={option} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-2 rounded">
              <input
                type="checkbox"
                checked={recommendations.includes(option)}
                onChange={() => toggleRecommendation(option)}
                className="w-4 h-4"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Summary */}
      {(rightEarResults?.degree || leftEarResults?.degree) && (
        <div className="bg-blue-50 border border-blue-200 p-4 rounded">
          <div className="font-semibold text-blue-900 mb-2">📊 Summary</div>
          <div className="text-sm text-blue-800 space-y-1">
            {rightEarResults?.degree && (
              <p><strong>Right Ear:</strong> {rightEarResults.degree.replace('_', ' ')} {rightEarResults.type || ''} hearing loss {rightEarResults.config ? `with ${rightEarResults.config.replace('_', ' ')} configuration` : ''}</p>
            )}
            {leftEarResults?.degree && (
              <p><strong>Left Ear:</strong> {leftEarResults.degree.replace('_', ' ')} {leftEarResults.type || ''} hearing loss {leftEarResults.config ? `with ${leftEarResults.config.replace('_', ' ')} configuration` : ''}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultsPanel;
