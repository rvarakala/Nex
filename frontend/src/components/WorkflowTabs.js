import React from 'react';

const WorkflowTabs = ({ activeTab, onTabChange, completedTabs }) => {
  const tabs = [
    { id: 'pta', label: '🎯 PTA', icon: '🎯' },
    { id: 'speech', label: '🗣️ Speech', icon: '🗣️' },
    { id: 'results', label: '✓ Results', icon: '✓' },
  ];

  return (
    <div className="bg-gradient-to-b from-gray-100 to-gray-200 border-b-2 border-blue-500 px-5 py-2 flex gap-1 items-center">
      {tabs.map((tab, index) => (
        <React.Fragment key={tab.id}>
          <button
            onClick={() => onTabChange(tab.id)}
            className={`
              px-5 py-2 border border-gray-400 border-b-0 rounded-t-md font-medium text-sm
              transition-all duration-200 flex items-center gap-2 relative
              ${
                activeTab === tab.id
                  ? 'bg-white text-black shadow-lg -mb-0.5 pb-3'
                  : 'bg-gray-300 text-gray-600 hover:bg-gray-200'
              }
            `}
          >
            {tab.label}
            {completedTabs.includes(tab.id) && (
              <span className="absolute top-1 right-1.5 text-green-600 text-xs font-bold">✓</span>
            )}
          </button>
          {index < tabs.length - 1 && <span className="text-gray-500 text-lg">›</span>}
        </React.Fragment>
      ))}
    </div>
  );
};

export default WorkflowTabs;