import { api } from './api.js';

// Minimal client-side error reporting: window errors and unhandled rejections
// are posted to /api/errors and surface in the Admin dashboard. The server
// dedupes identical messages, and we skip silently when logged out so auth
// failures never flood the table.
let tokenRef = null;
let installed = false;

export function setErrorLogToken(token) {
  tokenRef = token;
}

export function installErrorLogging() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  function send(message, stack, url, kind) {
    if (!tokenRef) return;
    api('/errors', {
      method: 'POST',
      token: tokenRef,
      body: { message: String(message || 'Script error.').slice(0, 500), stack, url, kind },
    }).catch(() => {});
  }

  window.addEventListener('error', (e) => {
    send(e.message || 'Script error.', e.error?.stack || '', e.filename || window.location.href, 'window');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    send(
      reason instanceof Error ? reason.message : 'Unhandled promise rejection',
      reason instanceof Error ? reason.stack : String(reason),
      window.location.href,
      'promise'
    );
  });
}
