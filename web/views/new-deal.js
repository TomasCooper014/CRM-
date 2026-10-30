import { useState } from '../lib/deps.js';
import { html, useLoad, Loading, ErrorBox, toast, go } from '../lib/ui.js';
import { createDeal, team, person as loadPerson, lead as loadLead, markLeadBooked } from '../lib/db.js';
import { brisbaneToIso, normalisePhone, fullName, localDate } from '../lib/logic.js';

const SOURCES = ['Facebook', 'Referral', 'Website', 'Response Boss', 'WHY Solar', 'Energet', 'Other'];

export function NewDeal({ me, personId, leadId }) {
  const { loading, error, data, reload } = useLoad(async () => {
    const lead = leadId ? await loadLead(leadId) : null;
    const pid = personId || lead?.person?.id;
    return Promise.all([team(), pid ? loadPerson(pid) : null, lead]);
  }, [personId, leadId]);
  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const [people, existing, lead] = data;
  return html`<${Form} key=${leadId || personId || 'blank'} me=${me}
    reps=${people.filter((p) => p.role === 'rep' || p.role === 'admin')} existing=${existing} lead=${lead} />`;
}

// Lead sources in the inbox map onto the deal's Lead Source list.
const SOURCE_FROM_LEAD = { 'WHY Solar': 'WHY Solar', Website: 'Website', Facebook: 'Facebook', Energet: 'Energet', Referral: 'Referral' };

function Form({ me, reps, existing, lead }) {
  const [f, setF] = useState({
    first_name: '', last_name: '', phone: '', email: '',
    site_address: '', site_suburb: lead?.suburb || '', site_postcode: lead?.postcode || existing?.postcode || '',
    appt_date: localDate(), appt_time: '10:00',
    consultant_id: me.role === 'rep' ? me.id : '',
    bill_size: existing?.bill_size || '', lead_source: SOURCE_FROM_LEAD[lead?.source] || (lead ? 'Other' : ''),
    value_aud: '', note: lead?.notes || '',
    home_owner: 'Own', both_owners: true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    const name = existing ? fullName(existing) : `${f.first_name} ${f.last_name}`.trim();
    if (!name) { toast('Add the customer’s name'); return; }
    if (!f.consultant_id) { toast('Pick a consultant'); return; }
    setBusy(true);
    try {
      const at = brisbaneToIso(f.appt_date, f.appt_time);
      const suburb = f.site_suburb.trim();
      const id = await createDeal({
        personId: existing?.id,
        person: existing ? null : {
          first_name: f.first_name.trim(), last_name: f.last_name.trim(),
          phones: f.phone ? [normalisePhone(f.phone)] : [],
          emails: f.email ? [f.email.trim().toLowerCase()] : [],
          bill_size: f.bill_size || null, owner_id: me.id,
        },
        deal: {
          title: suburb ? `${name} — ${suburb}` : name,
          owner_id: me.id, consultant_id: f.consultant_id, stage_id: 1,
          value_aud: Number(f.value_aud || 0),
          site_address: f.site_address.trim() || null, site_suburb: suburb || null,
          site_postcode: f.site_postcode.trim() || null, site_state: 'QLD',
          appointment_at: at, home_owner: f.home_owner, lead_source: f.lead_source || null,
          appointment_types: f.both_owners ? ['Both Homeowners'] : ['Single Legger'],
        },
        appointment: at ? {
          type: 'site_appointment', subject: `${name} — site appointment`,
          due_date: f.appt_date, due_at: at, duration: '01:00',
          owner_id: f.consultant_id,
          location: [f.site_address, f.site_suburb, 'QLD', f.site_postcode].filter(Boolean).join(', '),
          note: f.note || null,
        } : null,
      });
      if (lead) await markLeadBooked(lead.id, id);
      toast(lead ? 'Booked — lead moved out of the inbox' : 'Deal created');
      go(lead ? '/leads' : '/deal/' + id);
    } catch (x) { toast(x.message); setBusy(false); }
  }

  return html`<form class="stack" onSubmit=${save}>
    <h2>New booked appointment</h2>
    ${lead && html`<p class="muted small">From lead: ${lead.title}</p>`}
    <fieldset class="card stack-sm">
      <legend>Customer</legend>
      ${existing ? html`<div class="title">${fullName(existing)}</div>` : html`
        <div class="grid2">
          <label>First name<input required value=${f.first_name} onInput=${set('first_name')} /></label>
          <label>Last name<input value=${f.last_name} onInput=${set('last_name')} /></label>
        </div>
        <label>Mobile<input inputmode="tel" value=${f.phone} onInput=${set('phone')} /></label>
        <label>Email<input type="email" value=${f.email} onInput=${set('email')} /></label>`}
    </fieldset>
    <fieldset class="card stack-sm">
      <legend>Site</legend>
      <label>Street address<input value=${f.site_address} onInput=${set('site_address')} placeholder="39 Palma Rosa Dr" /></label>
      <div class="grid2">
        <label>Suburb<input value=${f.site_suburb} onInput=${set('site_suburb')} /></label>
        <label>Postcode<input inputmode="numeric" maxlength="4" value=${f.site_postcode} onInput=${set('site_postcode')} /></label>
      </div>
      <div class="grid2">
        <label>Owns or rents<select value=${f.home_owner} onChange=${set('home_owner')}><option>Own</option><option>Rent</option></select></label>
        <label>Bill size<input value=${f.bill_size} onInput=${set('bill_size')} placeholder="$600 a quarter" /></label>
      </div>
    </fieldset>
    <fieldset class="card stack-sm">
      <legend>Appointment</legend>
      <div class="grid2">
        <label>Date<input type="date" required value=${f.appt_date} onInput=${set('appt_date')} /></label>
        <label>Time (QLD)<input type="time" required value=${f.appt_time} onInput=${set('appt_time')} /></label>
      </div>
      <label>Consultant<select required value=${f.consultant_id} onChange=${set('consultant_id')}>
        <option value="">Choose…</option>
        ${reps.map((r) => html`<option value=${r.id}>${r.full_name}</option>`)}
      </select></label>
      <label class="check"><input type="checkbox" checked=${f.both_owners} onChange=${set('both_owners')} /> Both homeowners will be there</label>
      <div class="grid2">
        <label>Lead source<select value=${f.lead_source} onChange=${set('lead_source')}>
          <option value="">—</option>${SOURCES.map((s) => html`<option>${s}</option>`)}</select></label>
        <label>Est. value ($)<input inputmode="numeric" value=${f.value_aud} onInput=${set('value_aud')} /></label>
      </div>
      <label>Setter notes<textarea rows="4" value=${f.note} onInput=${set('note')} placeholder="Wants battery, bills $800/qtr, wife Alison…"></textarea></label>
    </fieldset>
    <button class="primary" disabled=${busy}>${busy ? 'Saving…' : 'Create deal'}</button>
  </form>`;
}
