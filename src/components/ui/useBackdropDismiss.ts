import { useRef } from 'react';

/**
 * Click-outside-to-close for a modal backdrop, without the false-positive a
 * plain `onClick={(e) => e.target === e.currentTarget && onClose()}` has:
 * selecting text inside the modal and releasing the mouse button outside it
 * (dragging past the panel edge) fires a click on the backdrop too, since a
 * click's target is wherever the mouseUP landed, not where the drag started.
 * That closed the modal mid-selection.
 *
 * Tracking mousedown separately fixes it: only close when BOTH the
 * mousedown and the click landed on the backdrop itself, never when the
 * gesture started inside the panel.
 */
export function useBackdropDismiss(onClose: () => void) {
  const mouseDownOnBackdrop = useRef(false);

  return {
    onMouseDown: (e: React.MouseEvent) => {
      mouseDownOnBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && mouseDownOnBackdrop.current) {
        onClose();
      }
    },
  };
}
