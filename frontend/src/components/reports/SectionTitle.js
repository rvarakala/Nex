import React from 'react';

// Shared section heading used across all report body sections.
export const SectionTitle = ({ children }) => (
  <h3 className="text-[12px] font-bold text-blue-800 border-b border-gray-300 pb-0.5 mt-2 mb-1">
    {children}
  </h3>
);
