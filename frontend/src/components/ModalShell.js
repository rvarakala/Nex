/**
 * ModalShell — opinionated modal backdrop that only closes when the user
 * truly clicks on the backdrop (mousedown AND mouseup both on the backdrop).
 *
 * Fixes the "popup suddenly disappears while typing" bug where a native
 * <select> dropdown's mouseup event bubbled to the backdrop and triggered
 * close, even though the user never clicked outside the modal.
 */
import React, { useRef } from 'react';

export default function ModalShell({
  onClose,
  children,
  className = '',
  cardClassName = 'max-w-xl w-full p-5',
  testid,
}) {
  const downOnBackdrop = useRef(false);

  const onBackdropDown = (e) => {
    downOnBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdropUp = (e) => {
    if (downOnBackdrop.current && e.target === e.currentTarget) {
      onClose?.();
    }
    downOnBackdrop.current = false;
  };

  return (
    <div
      className={`fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 ${className}`}
      onMouseDown={onBackdropDown}
      onMouseUp={onBackdropUp}
      data-testid={testid}
    >
      <div
        className={`bg-white rounded-lg shadow-2xl ${cardClassName}`}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
