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
      // pb-24 on mobile reserves ~96px at the bottom so the modal card
      // never sits under the fixed mobile bottom-nav (z-40, ~72px tall
      // + safe-area). Every modal in the app benefits from this shell,
      // keeping "buttons hidden below bottom-nav" bugs from recurring.
      className={`fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 pb-24 md:pb-4 ${className}`}
      onMouseDown={onBackdropDown}
      onMouseUp={onBackdropUp}
      data-testid={testid}
    >
      <div
        // `max-h` + `overflow-y-auto` guarantee the card content is
        // scrollable when it's taller than the visible viewport. `dvh`
        // reflects the browser's real visible height (accounts for
        // auto-hiding URL bars). `sm:max-h-[90vh]` restores the roomier
        // desktop cap where the bottom-nav doesn't exist.
        className={`bg-white rounded-lg shadow-2xl overflow-y-auto max-h-[calc(100dvh-96px)] sm:max-h-[90vh] ${cardClassName}`}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
