import React from 'react';

/**
 * Clinical-style placeholder panel for tabs whose content is not yet implemented.
 * Keeps the NOAH-style compact feel while clearly indicating the scope of the tab.
 */
const TabPlaceholder = ({ title, subtests = [], note }) => {
  return (
    <div className="flex-1 flex min-h-0 bg-gray-50 overflow-auto">
      <div className="m-4 flex-1 bg-white border border-gray-300 rounded shadow-sm p-4">
        <div className="border-b border-gray-200 pb-2 mb-3">
          <h2 className="text-sm font-bold text-gray-800" data-testid="tab-placeholder-title">
            {title}
          </h2>
          {note && <p className="text-xs text-gray-500 mt-0.5">{note}</p>}
        </div>

        {subtests.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-2">
              Planned sub-tests / procedures:
            </div>
            <ul className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
              {subtests.map((t) => (
                <li
                  key={t}
                  className="text-xs text-gray-700 flex items-center gap-1.5"
                >
                  <span className="inline-block w-1 h-1 bg-gray-400 rounded-full" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 text-[11px] text-gray-400 italic">
          UI for this module is scheduled in upcoming phases.
        </div>
      </div>
    </div>
  );
};

export default TabPlaceholder;
