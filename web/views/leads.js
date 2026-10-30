import { useState } from '../lib/deps.js';
import { html, useLoad, Loading, ErrorBox, toast } from '../lib/ui.js';
import { leadInbox, logLeadCall, addLead } from '../lib/db.js';
import { leadQueues, fullName, ago, when, brisbaneToIso, localDate, addDays, normalisePhone } from '../lib/logic.js';

const SOURCES = ['WHY Solar', 'Website', 'Facebook', 'Energet', 'Referral', 'Other'];

export function Leads() {
  const { loading, error, data, reload } = useLoad(() => leadInbox(), []);
  const [open, setOpen] = useState(null);   // lead id with the call panel open
  const [adding, setAdding] = useState(false);

  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const q = leadQueues(data);
  const total = q.due.length + q.fresh.length + q.retry.length;

  const section = (title, items, hint) => items.length ? html`<section class="stack-sm">
    <h3>${title} <span class="count">${items.length}</span></h3>
    ${hint && html`<p class="muted small">${hint}</p>`}
    ${items.map((l) => html`<${LeadCard} key=${l.id} l=${l} open=${open === l.id}
      onToggle=${() => setOpen(open === l.id ? null : l.id)} onLogged=${() => { setOpen(null); reload(); }} />`)}
  </section>` : null;

  return html`
    <div class="row between">
      <h2>Leads <span class="muted small">${total} to call</span></h2>
      <button onClick=${() => setAdding(!adding)}>${adding ? 'Cancel' : '+ Add lead'}</button>
    </div>
    ${adding && html`<${AddLead} onDone=${() => { setAdding(false); reload(); }} />`}
    ${section('Call back now', q.due)}
    ${section('New', q.fresh, 'Newest first — call within 5 minutes where you can.')}
    ${section('Try again', q.retry, 'Called before with no answer; longest-waiting first.')}
    ${section('Call-backs booked', q.later)}
    ${!data.length && html`<p class="muted">Inbox clear. Nice work.</p>`}
  `;
}

function LeadCard({ l, open, onToggle, onLogged }) {
  const p = l.person;
  const phone = p?.phones?.[0];
  return html`<article class="item lead">
    <div class="grow stack-sm">
      <button class="plain" onClick=${onToggle} aria-expanded=${open}>
        <div class="title">${p ? fullName(p) : l.title}</div>
        <div class="muted small">
          ${[l.product_interest, [l.suburb, l.postcode].filter(Boolean).join(' '), l.source].filter(Boolean).join(' · ')}
        </div>
        <div class="meta">
          ${l.status === 'callback' && l.next_call_at ? `Call back ${when(l.next_call_at)}` : `Came in ${ago(l.created_at)}`}
          ${l.attempts ? ` · ${l.attempts} call${l.attempts === 1 ? '' : 's'}${l.last_outcome ? `, last: ${l.last_outcome}` : ''}` : ''}
        </div>
      </button>
      ${open && html`<${CallPanel} l=${l} onLogged=${onLogged} />`}
    </div>
    <div class="actions">${phone && html`<a class="icon-btn" href=${'tel:' + phone} aria-label=${'Call ' + phone}>📞</a>`}</div>
  </article>`;
}

function CallPanel({ l, onLogged }) {
  const [mode, setMode] = useState(null); // 'callback' | 'dead'
  const [date, setDate] = useState(addDays(localDate(), 1));
  const [time, setTime] = useState('10:00');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const p = l.person;

  async function log(result, extra) {
    setBusy(true);
    try { await logLeadCall(l, result, extra); toast(`Logged: ${result}`); onLogged(); }
    catch (e) { toast(e.message); setBusy(false); }
  }

  return html`<div class="sub stack-sm">
    ${p?.phones?.length > 0 && html`<div>${p.phones.map((ph) => html`<a href=${'tel:' + ph}>📞 ${ph}</a> `)}</div>`}
    ${p?.emails?.[0] && html`<div class="small"><a href=${'mailto:' + p.emails[0]}>✉︎ ${p.emails[0]}</a></div>`}
    ${p?.bill_size && html`<div class="small"><span class="muted">Bill:</span> ${p.bill_size}</div>`}
    ${l.notes && html`<div class="small pre">${l.notes}</div>`}
    <div class="row wrap">
      <a class="button primary" href=${`#/new?lead=${l.id}`}>Book appointment</a>
      <button disabled=${busy} onClick=${() => log('No answer')}>No answer</button>
      <button disabled=${busy} onClick=${() => log('Left voicemail')}>Voicemail</button>
      <button disabled=${busy} onClick=${() => setMode(mode === 'callback' ? null : 'callback')}>Call back…</button>
      <button disabled=${busy} class="warn-btn" onClick=${() => setMode(mode === 'dead' ? null : 'dead')}>Not interested…</button>
    </div>
    ${mode === 'callback' && html`<form class="stack-sm" onSubmit=${(e) => { e.preventDefault();
        log('Call back', { nextCallAt: brisbaneToIso(date, time), note: note || null }); }}>
      <div class="grid2">
        <label>Date<input type="date" required value=${date} onInput=${(e) => setDate(e.target.value)} /></label>
        <label>Time (QLD)<input type="time" required value=${time} onInput=${(e) => setTime(e.target.value)} /></label>
      </div>
      <input placeholder="Note, e.g. wife decides, call after 5" value=${note} onInput=${(e) => setNote(e.target.value)} />
      <button class="primary" disabled=${busy}>Save call-back</button>
    </form>`}
    ${mode === 'dead' && html`<form class="stack-sm" onSubmit=${(e) => { e.preventDefault(); log('Not interested', { note: note || null }); }}>
      <input placeholder="Reason (renting, just got solar, …)" value=${note} onInput=${(e) => setNote(e.target.value)} />
      <button class="warn-btn" disabled=${busy}>Close lead</button>
    </form>`}
  </div>`;
}

function AddLead({ onDone }) {
  const [f, setF] = useState({ first_name: '', last_name: '', phone: '', email: '', suburb: '', postcode: '',
    source: 'Referral', product_interest: 'Solar & Battery', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    if (!f.phone && !f.email) { toast('Add a phone or email'); return; }
    setBusy(true);
    try {
      const name = `${f.first_name} ${f.last_name}`.trim();
      await addLead({
        person: { first_name: f.first_name.trim(), last_name: f.last_name.trim(),
          phones: f.phone ? [normalisePhone(f.phone)] : [], emails: f.email ? [f.email.trim().toLowerCase()] : [],
          postcode: f.postcode || null },
        lead: { title: [name, f.product_interest, `${f.suburb} ${f.postcode}`.trim()].filter(Boolean).join(' — '),
          source: f.source, product_interest: f.product_interest, suburb: f.suburb || null,
          postcode: f.postcode || null, notes: f.notes || null },
      });
      toast('Lead added'); onDone();
    } catch (x) { toast(x.message); setBusy(false); }
  }
  return html`<form class="card stack-sm" onSubmit=${save}>
    <div class="grid2">
      <label>First name<input required value=${f.first_name} onInput=${set('first_name')} /></label>
      <label>Last name<input value=${f.last_name} onInput=${set('last_name')} /></label>
    </div>
    <div class="grid2">
      <label>Mobile<input inputmode="tel" value=${f.phone} onInput=${set('phone')} /></label>
      <label>Email<input type="email" value=${f.email} onInput=${set('email')} /></label>
    </div>
    <div class="grid2">
      <label>Suburb<input value=${f.suburb} onInput=${set('suburb')} /></label>
      <label>Postcode<input inputmode="numeric" maxlength="4" value=${f.postcode} onInput=${set('postcode')} /></label>
    </div>
    <div class="grid2">
      <label>Source<select value=${f.source} onChange=${set('source')}>${SOURCES.map((s) => html`<option>${s}</option>`)}</select></label>
      <label>Interested in<select value=${f.product_interest} onChange=${set('product_interest')}>
        <option>Solar & Battery</option><option>Add a Battery</option><option>Solar Panels</option><option>Battery & More Panels</option>
      </select></label>
    </div>
    <label>Notes<textarea rows="2" value=${f.notes} onInput=${set('notes')}></textarea></label>
    <button class="primary" disabled=${busy}>Add lead</button>
  </form>`;
}
