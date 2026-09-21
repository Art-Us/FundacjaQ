/**
 * navigator.clipboard only exists in a "secure context" (HTTPS, or
 * http://localhost) — plain HTTP over a LAN IP or any other non-localhost
 * host leaves it undefined, and calling .writeText() on it throws a
 * TypeError that crashes whatever click handler called it. Falls back to
 * the older execCommand('copy') path (deprecated, but still works in an
 * insecure context) rather than letting the click do nothing or crash.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path below
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Off-screen, but still focusable/selectable — execCommand('copy') only
    // acts on the current DOM selection.
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
