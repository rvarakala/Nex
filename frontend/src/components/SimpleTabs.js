import React from 'react';

const SimpleTabs = ({ activeTab, onTabChange }) => {
  const tabs = [
    { id: 'pure_tone', label: 'Pure Tone' },
    { id: 'speech', label: 'Speech' },
    { id: 'impedance', label: 'Impedance' },
  ];

  return (
    <div className="flex items-center gap-1 bg-gray-200 px-4 py-2 border-b border-gray-300">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            px-6 py-2 text-sm font-medium rounded-t
            transition-colors duration-150
            ${
              activeTab === tab.id
                ? 'bg-white text-gray-900 border-t-2 border-x border-gray-300'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-50'
            }
          `}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default SimpleTabs;
