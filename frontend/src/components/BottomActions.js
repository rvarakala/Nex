import React from 'react';

const BottomActions = ({ onSave, onPreview, onFinalize, isSaving }) => {
  return (
    <div className="bg-gray-50 border-t border-gray-300 px-5 py-3 flex justify-between items-center">
      <div className="flex gap-4 items-center">
        <div className="text-xs text-gray-600">
          Last saved: {new Date().toLocaleTimeString()}
        </div>
      </div>
      
      <div className="flex gap-3">
        <button
          onClick={onSave}
          disabled={isSaving}
          className="px-4 py-2 border border-gray-300 bg-white rounded text-sm font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? '💾 Saving...' : '💾 Save Draft'}
        </button>
        <button
          onClick={onPreview}
          className="px-4 py-2 border border-blue-500 bg-blue-500 text-white rounded text-sm font-medium hover:bg-blue-600 transition-colors"
        >
          👁️ Preview Report
        </button>
        <button
          onClick={onFinalize}
          className="px-4 py-2 border border-green-600 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 transition-colors"
        >
          ✅ Finalize & Sign
        </button>
      </div>
    </div>
  );
};

export default BottomActions;