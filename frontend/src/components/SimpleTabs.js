import React from 'react';

const SimpleTabs = ({ activeTab, onTabChange }) => {
  const tabs = [
    { id: 'pre_test',     label: 'Pre-Test' },
    { id: 'pure_tone',    label: 'Pure Tone' },
    { id: 'speech',       label: 'Speech' },
    { id: 'impedance',    label: 'Impedance' },
    { id: 'special',      label: 'Special Tests' },
    { id: 'oae',          label: 'OAE' },
    { id: 'soundfield',   label: 'Sound Field / Aided' },
    { id: 'abr',          label: 'ABR / ASSR' },
    { id: 'pediatric',    label: 'Pediatric' },
    { id: 'tinnitus',     label: 'Tinnitus' },
    { id: 'reports',      label: 'Reports' },
  ];

  return (
    <div className="flex items-center gap-0.5 bg-gray-200 px-2 pt-1 border-b border-gray-300 overflow-x-auto flex-shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          data-testid={`tab-${tab.id}`}
          className={`
            px-3 py-1.5 text-xs font-medium rounded-t whitespace-nowrap
            transition-colors duration-150
            ${
              activeTab === tab.id
                ? 'bg-white text-gray-900 border-t-2 border-x border-gray-400 border-t-blue-500'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-50 border border-gray-200'
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
