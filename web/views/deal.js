import { useState } from '../lib/deps.js';
import { html, useLoad, Loading, ErrorBox, toast, ACTIVITY_LABELS, ACTIVITY_ICON } from '../lib/ui.js';
import { deal as loadDeal, lookups, updateDeal, addNote, addActivity, setActivityDone } from '../lib/db.js';
import { fullName, money, when, dayLabel, timeOnly, mapsLink, brisbaneToIso, localDate, addDays } from '../lib/logic.js';

const OUTCOMES = ['Sat', 'Single Legger F/Up', 'F/Up', 'Special Approval', 'New Build', 'Sat & Sold',
  'Reschedule - No Show/On The Door', 'Sat but Not Sold', 'DNQ', 'Cancellation'];

export function DealPage({ id, me }) {
  const { loading, error, data, reload } = useLoad(() => Promise.all([loadDeal(id), lookups()]), [id]);
  const [panel, setPanel] = useState(null); // 'lost' | 'edit' | 'activity'

  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const [d, lk] = data;
  const p = d.person;
  const phone = p?.phones?.[0];
  const address = [d.site_address, d.site_suburb, d.site_state, d.site_postcode].filter(Boolean).join(', ');
  const lostReason = lk.lostReasons.find((r) => r.id === d.lost_reason_id);

  async function patch(fields, msg = 'Saved') {
    try { await updateDeal(d.id, fields); toast(msg); setPanel(null); reload(); }
    catch (e) { toast(e.message); }
  }

  return html`
    <a class="back" href="#/pipeline">‹ Pipeline</a>
    <div class="card stack-sm">
      <h2>${d.title}</h2>
      ${p && html`<a href=${'#/contact/' + p.id}>${fullName(p)}</a>`}
      ${d.status === 'open' ? html`
        <label class="inline">Stage
          <select value=${d.stage_id} onChange=${(e) => patch({ stage_id: Number(e.target.value) }, 'Stage updated')}>
            ${lk.stages.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select></label>` : html`
        <div class=${d.status === 'won' ? 'good' : 'warn'}>
          <strong>${d.status === 'won' ? 'Won' : 'Lost'}</strong>
          ${lostReason ? ` — ${lostReason.label}` : ''}${d.lost_note ? ` (${d.lost_note})` : ''}
          <button class="link" onClick=${() => patch({ status: 'open', lost_reason_id: null }, 'Reopened')}>Reopen</button>
        </div>`}
      <div class="row wrap">
        ${phone && html`<a class="button" href=${'tel:' + phone}>📞 Call</a>`}
        ${phone && html`<a class="button" href=${'sms:' + phone}>💬 Text</a>`}
        ${address && html`<a class="button" href=${mapsLink(address)} target="_blank" rel="noopener">🧭 Directions</a>`}
        ${d.status === 'open' && html`
          <button class="good-btn" onClick=${() => patch({ status: 'won' }, 'Marked won 🎉')}>Won</button>
          <button class="warn-btn" onClick=${() => setPanel('lost')}>Lost</button>`}
      </div>
    </div>

    ${d.status === 'won' && html`<${InstallCard} d=${d} me=${me} />`}

    ${panel === 'lost' && html`<${LostForm} reasons=${lk.lostReasons} onCancel=${() => setPanel(null)}
      onSave=${(reasonId, note) => patch({ status: 'lost', lost_reason_id: reasonId, lost_note: note || null }, 'Marked lost')} />`}

    ${panel === 'edit' ? html`<${EditDeal} d=${d} labels=${lk.labels.filter((l) => l.scope === 'deal')}
        onCancel=${() => setPanel(null)} onSave=${patch} />` : html`
      <div class="card stack-sm">
        <div class="row between"><h3>Details</h3><button class="link" onClick=${() => setPanel('edit')}>Edit</button></div>
        <dl class="facts">
          <dt>Appointment</dt><dd>${d.appointment_at ? when(d.appointment_at) : '—'}</dd>
          <dt>Outcome</dt><dd>${d.appointment_outcome || '—'}</dd>
          <dt>Site</dt><dd>${address || '—'}</dd>
          <dt>Owns/rents</dt><dd>${d.home_owner || '—'}</dd>
          <dt>Bill</dt><dd>${p?.bill_size || '—'}</dd>
          <dt>Value</dt><dd>${money(d.value_aud)}</dd>
          <dt>Source</dt><dd>${d.lead_source || '—'}${d.campaign ? ` · ${d.campaign}` : ''}</dd>
          ${d.proposal_url && html`<dt>Proposal</dt><dd><a href=${d.proposal_url} target="_blank" rel="noopener">Open</a></dd>`}
          ${d.job_pack_url && html`<dt>Job pack</dt><dd><a href=${d.job_pack_url} target="_blank" rel="noopener">Open</a></dd>`}
        </dl>
      </div>`}

    <div class="card stack-sm">
      <div class="row between"><h3>Activities</h3>
        <button class="link" onClick=${() => setPanel(panel === 'activity' ? null : 'activity')}>+ Add</button></div>
      ${panel === 'activity' && html`<${ActivityForm} d=${d} me=${me}
        onDone=${() => { setPanel(null); reload(); }} onCancel=${() => setPanel(null)} />`}
      ${d.activities.map((a) => html`<div key=${a.id} class=${'item' + (a.done ? ' done' : '')}>
        <button class=${'tick' + (a.done ? ' on' : '')} aria-label=${a.done ? 'Mark not done' : 'Mark done'}
          onClick=${async () => { await setActivityDone(a.id, !a.done); reload(); }}></button>
        <div class="grow">
          <div class="meta">${ACTIVITY_ICON[a.type]} ${dayLabel(a.due_date)} · ${timeOnly(a.due_at)}</div>
          <div>${a.subject}</div>
          ${a.note && html`<div class="muted small pre">${a.note}</div>`}
        </div></div>`)}
      ${!d.activities.length && html`<p class="muted">No activities.</p>`}
    </div>

    <${Notes} d=${d} onAdded=${reload} />
  `;
}

function InstallCard({ d, me }) {
  const job = d.projects?.find((p) => p.status !== 'canceled');
  const canHandOver = me.role === 'admin' || me.role === 'ops';
  return html`<div class="card stack-sm">
    <h3>Installation</h3>
    ${job ? html`
      <div>With <strong>${job.partner?.name || 'partner not set'}</strong>${job.status === 'completed' ? ' — complete' : ''}
        ${job.scheduled_install_date ? html`<span class="muted"> · install ${job.scheduled_install_date}</span>` : ''}</div>
      ${canHandOver && html`<a href=${'#/project/' + job.id}>Open the job ›</a>`}`
    : canHandOver
      ? html`<p class="muted">Not handed to a partner yet.</p><a class="button primary" href=${'#/handover/' + d.id}>Hand over to partner</a>`
      : html`<p class="muted">Waiting for operations to hand this to an installation partner.</p>`}
  </div>`;
}

function LostForm({ reasons, onSave, onCancel }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  return html`<form class="card stack-sm" onSubmit=${(e) => { e.preventDefault(); if (reason) onSave(Number(reason), note); }}>
    <h3>Why was it lost?</h3>
    <select required value=${reason} onChange=${(e) => setReason(e.target.value)}>
      <option value="">Choose a reason…</option>
      ${reasons.map((r) => html`<option value=${r.id}>${r.label}</option>`)}
    </select>
    <input placeholder="Extra detail (optional)" value=${note} onInput=${(e) => setNote(e.target.value)} />
    <div class="row"><button class="warn-btn">Mark lost</button><button type="button" onClick=${onCancel}>Cancel</button></div>
  </form>`;
}

function EditDeal({ d, labels, onSave, onCancel }) {
  const [f, setF] = useState({
    title: d.title, value_aud: d.value_aud ?? 0, appointment_outcome: d.appointment_outcome || '',
    site_address: d.site_address || '', site_suburb: d.site_suburb || '', site_postcode: d.site_postcode || '',
    home_owner: d.home_owner || 'Own', proposal_url: d.proposal_url || '', job_pack_url: d.job_pack_url || '',
    label_ids: d.label_ids || [],
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleLabel = (id) => setF({ ...f, label_ids: f.label_ids.includes(id) ? f.label_ids.filter((x) => x !== id) : [...f.label_ids, id] });
  function save(e) {
    e.preventDefault();
    onSave({
      ...f, value_aud: Number(f.value_aud || 0), appointment_outcome: f.appointment_outcome || null,
      proposal_url: f.proposal_url || null, job_pack_url: f.job_pack_url || null,
    });
  }
  return html`<form class="card stack-sm" onSubmit=${save}>
    <h3>Edit details</h3>
    <label>Title<input value=${f.title} onInput=${set('title')} /></label>
    <div class="grid2">
      <label>Value ($)<input inputmode="numeric" value=${f.value_aud} onInput=${set('value_aud')} /></label>
      <label>Outcome<select value=${f.appointment_outcome} onChange=${set('appointment_outcome')}>
        <option value="">—</option>${OUTCOMES.map((o) => html`<option>${o}</option>`)}</select></label>
    </div>
    <label>Street address<input value=${f.site_address} onInput=${set('site_address')} /></label>
    <div class="grid2">
      <label>Suburb<input value=${f.site_suburb} onInput=${set('site_suburb')} /></label>
      <label>Postcode<input inputmode="numeric" value=${f.site_postcode} onInput=${set('site_postcode')} /></label>
    </div>
    <label>Proposal link<input type="url" value=${f.proposal_url} onInput=${set('proposal_url')} /></label>
    <label>Job pack link<input type="url" value=${f.job_pack_url} onInput=${set('job_pack_url')} /></label>
    <div class="tags">${labels.map((l) => html`<button type="button" class=${'tag ' + l.color + (f.label_ids.includes(l.id) ? ' picked' : '')}
      onClick=${() => toggleLabel(l.id)}>${l.label}</button>`)}</div>
    <div class="row"><button class="primary">Save</button><button type="button" onClick=${onCancel}>Cancel</button></div>
  </form>`;
}

function ActivityForm({ d, me, onDone, onCancel }) {
  const [f, setF] = useState({ type: 'call', subject: '', date: addDays(localDate(), 2), time: '', note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setBusy(true);
    try {
      await addActivity({
        type: f.type, subject: f.subject || ACTIVITY_LABELS[f.type], due_date: f.date,
        due_at: brisbaneToIso(f.date, f.time), note: f.note || null,
        owner_id: me.id, deal_id: d.id, person_id: d.person?.id ?? null,
      });
      toast('Added'); onDone();
    } catch (x) { toast(x.message); setBusy(false); }
  }
  return html`<form class="stack-sm sub" onSubmit=${save}>
    <div class="grid2">
      <label>Type<select value=${f.type} onChange=${set('type')}>
        ${Object.entries(ACTIVITY_LABELS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select></label>
      <label>Subject<input value=${f.subject} onInput=${set('subject')} placeholder=${ACTIVITY_LABELS[f.type]} /></label>
    </div>
    <div class="grid2">
      <label>Date<input type="date" required value=${f.date} onInput=${set('date')} /></label>
      <label>Time (optional)<input type="time" value=${f.time} onInput=${set('time')} /></label>
    </div>
    <label>Note<textarea rows="2" value=${f.note} onInput=${set('note')}></textarea></label>
    <div class="row"><button class="primary" disabled=${busy}>Add</button><button type="button" onClick=${onCancel}>Cancel</button></div>
  </form>`;
}

function Notes({ d, onAdded }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try { await addNote({ body: body.trim(), deal_id: d.id, person_id: d.person?.id ?? null }); setBody(''); onAdded(); }
    catch (x) { toast(x.message); }
    finally { setBusy(false); }
  }
  return html`<div class="card stack-sm">
    <h3>Notes</h3>
    <form class="stack-sm" onSubmit=${save}>
      <textarea rows="3" placeholder="Add a note…" value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
      <button class="primary" disabled=${busy || !body.trim()}>Save note</button>
    </form>
    ${d.notes.map((n) => html`<div key=${n.id} class="note">
      <div class="muted small">${n.author?.full_name || 'Imported'} · ${when(n.created_at)}${n.pinned ? ' · 📌' : ''}</div>
      <div class="pre">${n.body}</div></div>`)}
  </div>`;
}
