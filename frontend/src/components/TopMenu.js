import React from 'react';

const TopMenu = () => {
  return (
    <div className="bg-gray-100 border-b border-gray-300 px-5 py-2 flex gap-5 items-center shadow-sm">
      <div className="text-sm text-gray-600 hover:bg-gray-200 cursor-pointer px-2 py-1 rounded">File</div>
      <div className="text-sm text-gray-600 hover:bg-gray-200 cursor-pointer px-2 py-1 rounded">Audiology</div>
      <div className="text-sm text-gray-600 hover:bg-gray-200 cursor-pointer px-2 py-1 rounded">Tools</div>
      <div className="text-sm text-gray-600 hover:bg-gray-200 cursor-pointer px-2 py-1 rounded">Settings</div>
      <div className="text-sm text-gray-600 hover:bg-gray-200 cursor-pointer px-2 py-1 rounded">Help</div>
      <div className="ml-auto flex items-center gap-4">
        <span className="text-green-600 flex items-center gap-1">
          <span className="w-2 h-2 bg-green-600 rounded-full"></span>
          Online
        </span>
        <span className="text-sm text-gray-600">User: Dr. Audiologist</span>
      </div>
    </div>
  );
};

export default TopMenu;