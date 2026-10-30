// Operations: hand won jobs to installation partners and track them to commission paid.
import { useState } from '../lib/deps.js';
import { html, useLoad, Loading, ErrorBox, toast, go } from '../lib/ui.js';
import {
  handoverQueue, projectBoard, phases, project as loadProject, updateProject, handOver,
  partners, savePartner, deal as loadDeal, addNote,
} from '../lib/db.js';
import { fullName, money, ago, daysInPhase, when, localDate, mapsLink } from '../lib/logic.js';

const FINANCE = ['Cash', 'Brighte', 'Plenti', 'Other'];

// ───────── Board ─────────
export function Installs() {
  const { loading, error, data, reload } = useLoad(() => Promise.all([handoverQueue(), projectBoard(), phases()]), []);
  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const [queue, projects, ph] = data;

  async function move(p, phaseId) {
    try { await updateProject(p.id, { phase_id: phaseId }); toast('Moved'); reload(); }
    catch (e) { toast(e.message); }
  }

  const owed = projects.filter((p) => p.commission_aud && !p.commission_paid_on).reduce((s, p) => s + Number(p.commission_aud), 0);

  return html`
    <div class="row between">
      <h2>Installs</h2>
      <a class="button" href="#/partners">Partners</a>
    </div>
    ${owed > 0 && html`<p class="muted">Commission still to be paid on open jobs: <strong>${money(owed)}</strong></p>`}

    <section class="stack-sm">
      <h3 class=${queue.length ? 'warn' : ''}>Ready for handover <span class="count">${queue.length}</span></h3>
      ${queue.length ? queue.map((d) => html`<div key=${d.id} class="item">
        <div class="grow">
          <a class="title" href=${'#/deal/' + d.id}>${d.title}</a>
          <div class="muted small">${fullName(d.person)} · ${money(d.value_aud)} · won ${ago(d.won_at)}</div>
        </div>
        <a class="button primary" href=${'#/handover/' + d.id}>Hand over</a>
      </div>`) : html`<p class="muted">No won jobs waiting.</p>`}
    </section>

    <div class="board wide">
      ${ph.map((phase, i) => {
        const items = projects.filter((p) => p.phase_id === phase.id)
          .sort((a, b) => (a.phase_changed_at ?? '').localeCompare(b.phase_changed_at ?? ''));
        return html`<section key=${phase.id} class="col">
          <header><strong>${phase.name}</strong><span class="muted small">${items.length}</span></header>
          ${items.map((p) => {
            const stuck = !phase.is_final && daysInPhase(p) > 14;
            return html`<article key=${p.id} class=${'deal' + (stuck ? ' rotten' : '')}>
              <a href=${'#/project/' + p.id} class="title">${p.title}</a>
              <div class="muted small">${p.partner?.name || 'No partner'}${p.scheduled_install_date ? ` · install ${p.scheduled_install_date}` : ''}</div>
              <div class="small">${daysInPhase(p)} day${daysInPhase(p) === 1 ? '' : 's'} here${stuck ? html` <span class="warn">· chase up</span>` : ''}</div>
              <div class="row move">
                ${i > 0 && html`<button class="small" onClick=${() => move(p, ph[i - 1].id)}>‹</button>`}
                ${i < ph.length - 1 && html`<button class="small" onClick=${() => move(p, ph[i + 1].id)}>${ph[i + 1].name} ›</button>`}
              </div>
            </article>`;
          })}
          ${!items.length && html`<p class="muted small pad">Empty</p>`}
        </section>`;
      })}
    </div>`;
}

// ───────── Hand a won deal to a partner ─────────
export function Handover({ dealId }) {
  const { loading, error, data, reload } = useLoad(() => Promise.all([loadDeal(dealId), partners()]), [dealId]);
  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const [d, list] = data;
  if (d.status !== 'won') return html`<p class="warn pad">Only won deals can be handed over.</p>`;
  if (d.projects?.some((p) => p.status !== 'canceled')) {
    return html`<p class="pad">Already handed over. <a href=${'#/project/' + d.projects[0].id}>Open the job</a></p>`;
  }
  return html`<${HandoverForm} d=${d} list=${list} />`;
}

function HandoverForm({ d, list }) {
  const [f, setF] = useState({ partner_id: '', finance_provider: 'Cash', sale_price_aud: d.value_aud || '',
    commission_aud: '', partner_job_ref: '', note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    if (!f.partner_id) { toast('Choose a partner'); return; }
    setBusy(true);
    try {
      const id = await handOver(d, {
        partner_id: f.partner_id, finance_provider: f.finance_provider, partner_job_ref: f.partner_job_ref || null,
        sale_price_aud: f.sale_price_aud === '' ? null : Number(f.sale_price_aud),
        commission_aud: f.commission_aud === '' ? null : Number(f.commission_aud),
      });
      if (f.note.trim()) await addNote({ body: f.note.trim(), project_id: id, deal_id: d.id });
      toast('Handed over'); go('/project/' + id);
    } catch (x) { toast(x.message); setBusy(false); }
  }
  return html`<form class="stack" onSubmit=${save}>
    <a class="back" href=${'#/deal/' + d.id}>‹ ${d.title}</a>
    <h2>Hand over to partner</h2>
    <div class="card stack-sm">
      <div class="title">${fullName(d.person)}</div>
      <div class="muted small">${[d.site_address, d.site_suburb, d.site_postcode].filter(Boolean).join(', ')}</div>
      <div class="small">${d.person?.phones?.[0] || ''} ${d.person?.emails?.[0] ? '· ' + d.person.emails[0] : ''}</div>
      ${d.proposal_url && html`<a href=${d.proposal_url} target="_blank" rel="noopener">Proposal</a>`}
    </div>
    <fieldset class="card stack-sm">
      <label>Partner<select required value=${f.partner_id} onChange=${set('partner_id')}>
        <option value="">Choose…</option>${list.map((p) => html`<option value=${p.id}>${p.name}${p.regions ? ` — ${p.regions}` : ''}</option>`)}
      </select></label>
      ${!list.length && html`<p class="warn small">No partners yet. <a href="#/partners">Add one first.</a></p>`}
      <div class="grid2">
        <label>Sale price ($)<input inputmode="decimal" value=${f.sale_price_aud} onInput=${set('sale_price_aud')} /></label>
        <label>Our commission ($)<input inputmode="decimal" value=${f.commission_aud} onInput=${set('commission_aud')} /></label>
      </div>
      <div class="grid2">
        <label>Finance<select value=${f.finance_provider} onChange=${set('finance_provider')}>${FINANCE.map((x) => html`<option>${x}</option>`)}</select></label>
        <label>Partner's job no.<input value=${f.partner_job_ref} onInput=${set('partner_job_ref')} /></label>
      </div>
      <label>Handover notes<textarea rows="4" value=${f.note} onInput=${set('note')} placeholder="System sold, roof type, access, anything the partner needs to know"></textarea></label>
    </fieldset>
    <button class="primary" disabled=${busy}>${busy ? 'Saving…' : 'Hand over'}</button>
  </form>`;
}

// ───────── One job ─────────
export function ProjectPage({ id }) {
  const { loading, error, data, reload } = useLoad(() => Promise.all([loadProject(id), phases(), partners(true)]), [id]);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const [p, ph, list] = data;
  const d = p.deal;
  const address = d ? [d.site_address, d.site_suburb, 'QLD', d.site_postcode].filter(Boolean).join(', ') : '';

  async function patch(fields, msg = 'Saved') {
    try { await updateProject(p.id, fields); toast(msg); setEditing(false); reload(); }
    catch (e) { toast(e.message); }
  }
  async function saveNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    try { await addNote({ body: note.trim(), project_id: p.id, deal_id: p.deal_id }); setNote(''); reload(); }
    catch (x) { toast(x.message); }
  }

  return html`
    <a class="back" href="#/installs">‹ Installs</a>
    <div class="card stack-sm">
      <h2>${p.title}</h2>
      ${p.person && html`<a href=${'#/contact/' + p.person.id}>${fullName(p.person)}</a>`}
      <label class="inline">Stage
        <select value=${p.phase_id} onChange=${(e) => patch({ phase_id: Number(e.target.value) }, 'Stage updated')}>
          ${ph.map((x) => html`<option value=${x.id}>${x.name}</option>`)}
        </select></label>
      ${p.status === 'completed' && html`<div class="good"><strong>Complete</strong></div>`}
      <div class="row wrap">
        ${p.person?.phones?.[0] && html`<a class="button" href=${'tel:' + p.person.phones[0]}>📞 Customer</a>`}
        ${p.partner?.phone && html`<a class="button" href=${'tel:' + p.partner.phone}>📞 ${p.partner.name}</a>`}
        ${address && html`<a class="button" href=${mapsLink(address)} target="_blank" rel="noopener">🧭 Site</a>`}
        ${d && html`<a class="button" href=${'#/deal/' + d.id}>Sale details</a>`}
      </div>
    </div>

    ${editing ? html`<${EditProject} p=${p} list=${list} onSave=${patch} onCancel=${() => setEditing(false)} />` : html`
      <div class="card stack-sm">
        <div class="row between"><h3>Job</h3><button class="link" onClick=${() => setEditing(true)}>Edit</button></div>
        <dl class="facts">
          <dt>Partner</dt><dd>${p.partner?.name || '—'}${p.partner_job_ref ? ` (job ${p.partner_job_ref})` : ''}</dd>
          <dt>Handed over</dt><dd>${p.handed_over_at ? when(p.handed_over_at) : '—'}</dd>
          <dt>Finance</dt><dd>${p.finance_provider || '—'}</dd>
          <dt>Sale price</dt><dd>${p.sale_price_aud != null ? money(p.sale_price_aud) : '—'}</dd>
          <dt>Commission</dt><dd>${p.commission_aud != null ? money(p.commission_aud) : '—'}
            ${p.commission_paid_on ? html` <span class="good">paid ${p.commission_paid_on}</span>`
              : p.commission_aud ? html` <span class="warn">unpaid</span>` : ''}</dd>
          <dt>Install booked</dt><dd>${p.scheduled_install_date || '—'}</dd>
          <dt>Installed</dt><dd>${p.install_completed_date || '—'}</dd>
          <dt>Installer</dt><dd>${p.assigned_installer || '—'}</dd>
          ${p.installation_notes && html`<dt>Install notes</dt><dd class="pre">${p.installation_notes}</dd>`}
        </dl>
        ${p.commission_aud && !p.commission_paid_on && html`
          <button class="good-btn" onClick=${() => patch({ commission_paid_on: localDate() }, 'Commission marked paid')}>Mark commission paid today</button>`}
      </div>`}

    <div class="card stack-sm">
      <h3>Notes</h3>
      <form class="stack-sm" onSubmit=${saveNote}>
        <textarea rows="3" placeholder="Partner update, customer call…" value=${note} onInput=${(e) => setNote(e.target.value)}></textarea>
        <button class="primary" disabled=${!note.trim()}>Save note</button>
      </form>
      ${p.notes.map((n) => html`<div key=${n.id} class="note">
        <div class="muted small">${n.author?.full_name || 'Imported'} · ${when(n.created_at)}</div>
        <div class="pre">${n.body}</div></div>`)}
    </div>`;
}

function EditProject({ p, list, onSave, onCancel }) {
  const [f, setF] = useState({
    partner_id: p.partner_id || '', partner_job_ref: p.partner_job_ref || '', finance_provider: p.finance_provider || 'Cash',
    sale_price_aud: p.sale_price_aud ?? '', commission_aud: p.commission_aud ?? '', commission_paid_on: p.commission_paid_on || '',
    scheduled_install_date: p.scheduled_install_date || '', install_completed_date: p.install_completed_date || '',
    assigned_installer: p.assigned_installer || '', installation_notes: p.installation_notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const num = (v) => (v === '' ? null : Number(v));
  const orNull = (v) => (v === '' ? null : v);
  function save(e) {
    e.preventDefault();
    onSave({
      partner_id: orNull(f.partner_id), partner_job_ref: orNull(f.partner_job_ref), finance_provider: orNull(f.finance_provider),
      sale_price_aud: num(f.sale_price_aud), commission_aud: num(f.commission_aud), commission_paid_on: orNull(f.commission_paid_on),
      scheduled_install_date: orNull(f.scheduled_install_date), install_completed_date: orNull(f.install_completed_date),
      assigned_installer: orNull(f.assigned_installer), installation_notes: orNull(f.installation_notes),
    });
  }
  return html`<form class="card stack-sm" onSubmit=${save}>
    <h3>Edit job</h3>
    <div class="grid2">
      <label>Partner<select value=${f.partner_id} onChange=${set('partner_id')}>
        <option value="">—</option>${list.map((x) => html`<option value=${x.id}>${x.name}${x.active ? '' : ' (inactive)'}</option>`)}</select></label>
      <label>Partner's job no.<input value=${f.partner_job_ref} onInput=${set('partner_job_ref')} /></label>
    </div>
    <div class="grid2">
      <label>Sale price ($)<input inputmode="decimal" value=${f.sale_price_aud} onInput=${set('sale_price_aud')} /></label>
      <label>Commission ($)<input inputmode="decimal" value=${f.commission_aud} onInput=${set('commission_aud')} /></label>
    </div>
    <div class="grid2">
      <label>Finance<select value=${f.finance_provider} onChange=${set('finance_provider')}>${FINANCE.map((x) => html`<option>${x}</option>`)}</select></label>
      <label>Commission paid on<input type="date" value=${f.commission_paid_on} onInput=${set('commission_paid_on')} /></label>
    </div>
    <div class="grid2">
      <label>Install booked for<input type="date" value=${f.scheduled_install_date} onInput=${set('scheduled_install_date')} /></label>
      <label>Installed on<input type="date" value=${f.install_completed_date} onInput=${set('install_completed_date')} /></label>
    </div>
    <label>Installer / crew<input value=${f.assigned_installer} onInput=${set('assigned_installer')} /></label>
    <label>Install notes<textarea rows="3" value=${f.installation_notes} onInput=${set('installation_notes')}></textarea></label>
    <div class="row"><button class="primary">Save</button><button type="button" onClick=${onCancel}>Cancel</button></div>
  </form>`;
}

// ───────── Partners ─────────
export function Partners({ canEdit }) {
  const { loading, error, data, reload } = useLoad(() => partners(true), []);
  const [edit, setEdit] = useState(null); // partner object or {} for new
  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  return html`
    <a class="back" href="#/installs">‹ Installs</a>
    <div class="row between"><h2>Installation partners</h2>
      ${canEdit && html`<button onClick=${() => setEdit({})}>+ Add</button>`}</div>
    ${edit && html`<${PartnerForm} p=${edit} onDone=${() => { setEdit(null); reload(); }} />`}
    <div class="list">
      ${data.map((p) => html`<div key=${p.id} class=${'item' + (p.active ? '' : ' done')}>
        <div class="grow">
          <div class="title">${p.name}${p.active ? '' : ' (inactive)'}</div>
          <div class="muted small">${[p.contact_name, p.phone, p.email].filter(Boolean).join(' · ')}</div>
          ${p.regions && html`<div class="small">${p.regions}</div>`}
        </div>
        ${canEdit && html`<button class="link" onClick=${() => setEdit(p)}>Edit</button>`}
      </div>`)}
      ${!data.length && html`<p class="muted">No partners yet.</p>`}
    </div>`;
}

function PartnerForm({ p, onDone }) {
  const [f, setF] = useState({ name: p.name || '', contact_name: p.contact_name || '', phone: p.phone || '',
    email: p.email || '', regions: p.regions || '', notes: p.notes || '', active: p.active ?? true });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function save(e) {
    e.preventDefault(); setBusy(true);
    try { await savePartner({ ...(p.id ? { id: p.id } : {}), ...f }); toast('Saved'); onDone(); }
    catch (x) { toast(x.message); setBusy(false); }
  }
  return html`<form class="card stack-sm" onSubmit=${save}>
    <label>Company name<input required value=${f.name} onInput=${set('name')} /></label>
    <div class="grid2">
      <label>Contact<input value=${f.contact_name} onInput=${set('contact_name')} /></label>
      <label>Phone<input inputmode="tel" value=${f.phone} onInput=${set('phone')} /></label>
    </div>
    <label>Email<input type="email" value=${f.email} onInput=${set('email')} /></label>
    <label>Regions they cover<input value=${f.regions} onInput=${set('regions')} placeholder="Brisbane North, Sunshine Coast" /></label>
    <label>Notes<textarea rows="2" value=${f.notes} onInput=${set('notes')}></textarea></label>
    <label class="check"><input type="checkbox" checked=${f.active} onChange=${set('active')} /> Active</label>
    <div class="row"><button class="primary" disabled=${busy}>Save</button><button type="button" onClick=${onDone}>Cancel</button></div>
  </form>`;
}
