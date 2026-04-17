import React from 'react';

const TestMenu = ({ activeTest, onTestChange, completedTests }) => {
  const testSections = [
    {
      title: 'Pure Tone Tests',
      items: [
        { id: 'ac_right', label: 'AC - Right', icon: '🔴' },
        { id: 'ac_left', label: 'AC - Left', icon: '🔵' },
        { id: 'bc_right', label: 'BC - Right', icon: '🔴' },
        { id: 'bc_left', label: 'BC - Left', icon: '🔵' },
      ],
    },
    {
      title: 'Threshold Types',
      items: [
        { id: 'htl', label: 'HTL (Hearing)' },
        { id: 'mcl', label: 'MCL (Comfort)' },
        { id: 'ucl', label: 'UCL (Discomfort)' },
      ],
    },
  ];

  return (
    <div className="w-40 bg-gray-100 border-r border-gray-300 overflow-y-auto">
      {testSections.map((section) => (
        <div key={section.title} className="border-b border-gray-300">
          <div className="px-4 py-2.5 bg-gray-200 text-xs font-semibold uppercase text-gray-600 tracking-wide">
            {section.title}
          </div>
          {section.items.map((item) => (
            <button
              key={item.id}
              onClick={() => onTestChange(item.id)}
              className={`
                w-full px-4 py-2.5 text-sm text-left border-l-3 flex items-center gap-2
                transition-all duration-150
                ${
                  activeTest === item.id
                    ? 'bg-white border-blue-500 font-semibold text-black'
                    : 'border-transparent hover:bg-gray-50'
                }
              `}
            >
              {item.icon && <span>{item.icon}</span>}
              <span>{item.label}</span>
              {completedTests.includes(item.id) && (
                <span className="ml-auto text-green-600 text-xs font-bold">✓</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

export default TestMenu;