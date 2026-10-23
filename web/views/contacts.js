import { useState, useEffect } from '../lib/deps.js';
import { html, useLoad, Loading, ErrorBox, toast } from '../lib/ui.js';
import { searchPeople, person, updatePerson, lookups } from '../lib/db.js';
import { fullName, money, when, normalisePhone } from '../lib/logic.js';

export function Contacts() {
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(term), 250); return () => clearTimeout(t); }, [term]);
  const { loading, error, data, reload } = useLoad(() => searchPeople(q), [q]);

  return html`
    <h2>Contacts</h2>
    <input type="search" placeholder="Search name, phone or email" value=${term} onInput=${(e) => setTerm(e.target.value)} />
    ${loading && !data ? html`<${Loading} />` : error ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : html`
      <div class="list">
        ${data.map((p) => html`<a key=${p.id} class="item link-row" href=${'#/contact/' + p.id}>
          <div class="grow">
            <div class="title">${fullName(p)}</div>
            <div class="muted small">${[p.phones?.[0], p.emails?.[0], p.postcode].filter(Boolean).join(' · ')}</div>
          </div><span class="chev">›</span></a>`)}
        ${!data.length && html`<p class="muted">No matches.</p>`}
      </div>`}
  `;
}

export function ContactPage({ id }) {
  const { loading, error, data, reload } = useLoad(() => Promise.all([person(id), lookups()]), [id]);
  const [editing, setEditing] = useState(false);
  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const [p, { stages }] = data;
  const stageName = (sid) => stages.find((s) => s.id === sid)?.name ?? '';

  return html`
    <a class="back" href="#/contacts">‹ Contacts</a>
    ${editing ? html`<${EditPerson} p=${p} onDone=${() => { setEditing(false); reload(); }} />` : html`
      <div class="card stack-sm">
        <div class="row between"><h2>${fullName(p)}</h2><button class="link" onClick=${() => setEditing(true)}>Edit</button></div>
        ${p.phones.map((ph) => html`<a href=${'tel:' + ph}>📞 ${ph}</a>`)}
        ${p.emails.map((em) => html`<a href=${'mailto:' + em}>✉︎ ${em}</a>`)}
        ${p.postal_address && html`<div class="muted">${p.postal_address}</div>`}
        ${p.bill_size && html`<div><span class="muted">Bill:</span> ${p.bill_size}</div>`}
        ${(p.sms_opt_out || p.email_opt_out) && html`<div class="warn small">
          Opted out of ${[p.sms_opt_out && 'texts', p.email_opt_out && 'emails'].filter(Boolean).join(' and ')}</div>`}
      </div>`}
    <h3>Deals</h3>
    <div class="list">
      ${p.deals.map((d) => html`<a key=${d.id} class="item link-row" href=${'#/deal/' + d.id}>
        <div class="grow">
          <div class="title">${d.title}</div>
          <div class="muted small">${d.status === 'open' ? stageName(d.stage_id) : d.status.toUpperCase()}
            ${d.appointment_at ? ' · ' + when(d.appointment_at) : ''} · ${money(d.value_aud)}</div>
        </div><span class="chev">›</span></a>`)}
      ${!p.deals.length && html`<p class="muted">No deals yet.</p>`}
    </div>
    <a class="button" href=${'#/new?person=' + p.id}>+ New deal for ${p.first_name || 'this contact'}</a>
  `;
}

function EditPerson({ p, onDone }) {
  const [f, setF] = useState({
    first_name: p.first_name || '', last_name: p.last_name || '',
    phones: p.phones.join(', '), emails: p.emails.join(', '),
    postal_address: p.postal_address || '', bill_size: p.bill_size || '',
    sms_opt_out: p.sms_opt_out, email_opt_out: p.email_opt_out,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

  async function save(e) {
    e.preventDefault(); setBusy(true);
    try {
      await updatePerson(p.id, {
        ...f,
        phones: split(f.phones).map(normalisePhone),
        emails: split(f.emails).map((x) => x.toLowerCase()),
      });
      toast('Saved'); onDone();
    } catch (x) { toast(x.message); setBusy(false); }
  }
  return html`<form class="card stack" onSubmit=${save}>
    <div class="grid2">
      <label>First name<input value=${f.first_name} onInput=${set('first_name')} /></label>
      <label>Last name<input value=${f.last_name} onInput=${set('last_name')} /></label>
    </div>
    <label>Phones (comma separated)<input inputmode="tel" value=${f.phones} onInput=${set('phones')} /></label>
    <label>Emails (comma separated)<input inputmode="email" value=${f.emails} onInput=${set('emails')} /></label>
    <label>Postal address<input value=${f.postal_address} onInput=${set('postal_address')} /></label>
    <label>Bill size<input value=${f.bill_size} onInput=${set('bill_size')} /></label>
    <label class="check"><input type="checkbox" checked=${f.sms_opt_out} onChange=${set('sms_opt_out')} /> Opted out of texts</label>
    <label class="check"><input type="checkbox" checked=${f.email_opt_out} onChange=${set('email_opt_out')} /> Opted out of emails</label>
    <div class="row"><button class="primary" disabled=${busy}>Save</button><button type="button" onClick=${onDone}>Cancel</button></div>
  </form>`;
}
