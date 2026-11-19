/**
 * Copy plain text to the clipboard with a safe offscreen textarea fallback
 * for non-HTTPS origins or restricted browsers. Never throws.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return false;
  }

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback (e.g. HTTP origin or unfocused tab)
    }
  }

  if (typeof document === 'undefined' || !document.body) {
    return false;
  }

  const prevActive = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return Boolean(document.execCommand('copy'));
  } catch {
    return false;
  } finally {
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
    if (prevActive && typeof prevActive.focus === 'function') {
      try {
        prevActive.focus({ preventScroll: true });
      } catch {
        // Ignore focus restoration error
      }
    }
  }
}
