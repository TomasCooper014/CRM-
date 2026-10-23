import { useState } from '../lib/deps.js';
import { html } from '../lib/ui.js';
import { signIn, sendReset, setPassword } from '../lib/db.js';
import { COMPANY_NAME } from '../config.js';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try { await signIn(email.trim(), password); }
    catch (err) { setMsg({ error: true, text: err.message }); }
    finally { setBusy(false); }
  }
  async function forgot() {
    if (!email.trim()) { setMsg({ error: true, text: 'Type your email first, then tap “Forgot password”.' }); return; }
    setBusy(true);
    try { await sendReset(email.trim()); setMsg({ text: 'Check your email for a link to set a new password.' }); }
    catch (err) { setMsg({ error: true, text: err.message }); }
    finally { setBusy(false); }
  }

  return html`<main class="login">
    <form class="card stack" onSubmit=${submit}>
      <h1>${COMPANY_NAME}</h1>
      <label>Email<input type="email" autocomplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autocomplete="current-password" required value=${password} onInput=${(e) => setPw(e.target.value)} /></label>
      <button class="primary" disabled=${busy}>${busy ? 'Signing in…' : 'Sign in'}</button>
      <button type="button" class="link" onClick=${forgot} disabled=${busy}>Forgot password</button>
      ${msg && html`<p class=${msg.error ? 'error' : 'muted'}>${msg.text}</p>`}
    </form>
  </main>`;
}

/** Shown after someone follows an invite or password-reset link. */
export function SetPassword({ onDone }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (pw.length < 10) { setErr('Use at least 10 characters.'); return; }
    setBusy(true); setErr(null);
    try { await setPassword(pw); onDone(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }
  return html`<main class="login">
    <form class="card stack" onSubmit=${submit}>
      <h1>Set your password</h1>
      <label>New password<input type="password" autocomplete="new-password" value=${pw} onInput=${(e) => setPw(e.target.value)} /></label>
      <button class="primary" disabled=${busy}>Save password</button>
      ${err && html`<p class="error">${err}</p>`}
    </form>
  </main>`;
}
