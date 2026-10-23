// Shared UI helpers.
import { h, htm, useState, useEffect } from './deps.js';

export const html = htm.bind(h);

/** Load async data with loading/error state; re-runs when deps change. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => live && setState({ loading: false, error: null, data }),
      (e) => live && setState({ loading: false, error: e.message || String(e), data: null }),
    );
    return () => { live = false; };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function Loading() {
  return html`<div class="muted pad">Loading…</div>`;
}
export function ErrorBox({ error, onRetry }) {
  return html`<div class="error pad">
    <strong>Something went wrong.</strong> ${error}
    ${onRetry && html` <button class="link" onClick=${onRetry}>Try again</button>`}
  </div>`;
}

export function go(path) {
  location.hash = path;
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export const ACTIVITY_LABELS = {
  site_appointment: 'Site appointment', follow_up: 'Follow up', call: 'Call', meeting: 'Meeting',
  task: 'Task', email: 'Email', virtual_appointment: 'Virtual appointment', send_job_pack: 'Send job pack',
  installation: 'Installation', message: 'Message',
};
export const ACTIVITY_ICON = {
  site_appointment: '📍', follow_up: '↩︎', call: '📞', meeting: '👥', task: '✓', email: '✉︎',
  virtual_appointment: '💻', send_job_pack: '📦', installation: '🔧', message: '💬',
};
