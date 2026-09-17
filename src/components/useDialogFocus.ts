import { useEffect, useRef } from 'react';

/** Keep keyboard navigation inside a blocking dealer or confirmation dialog. */
export function useDialogFocus(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    const targets = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]'));
    const focusTarget = targets()[0] ?? dialog;
    focusTarget.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = targets();
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', trap);
    // Dismissing or expiring an alert can remove the currently focused button.
    const observer = new MutationObserver(() => {
      if (dialog.isConnected && document.activeElement === document.body) (targets()[0] ?? dialog).focus();
    });
    observer.observe(dialog, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      dialog.removeEventListener('keydown', trap);
      // A newly opened dialog owns focus; dismissing this one must not steal it back.
      const focusedDialog = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
      if (previous?.isConnected && (!focusedDialog || focusedDialog === dialog)) previous.focus();
    };
  }, [open]);
  return ref;
}
