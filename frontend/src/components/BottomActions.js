import React from 'react';

const BottomActions = ({ onSave, onPreview, onFinalize, isSaving }) => {
  return (
    <div className="bg-white border-t border-gray-200 px-6 py-3 flex justify-end items-center gap-3">
      <button
        onClick={onSave}
        disabled={isSaving}
        className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
      >
        {isSaving ? 'Saving...' : 'Save Draft'}
      </button>
      <button
        onClick={onPreview}
        className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
      >
        Preview Report
      </button>
      <button
        onClick={onFinalize}
        className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
      >
        Finalize
      </button>
    </div>
  );
};

export default BottomActions;