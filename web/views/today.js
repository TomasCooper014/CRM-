import { useState } from '../lib/deps.js';
import { html, useLoad, Loading, ErrorBox, toast, ACTIVITY_ICON } from '../lib/ui.js';
import { openActivities, setActivityDone } from '../lib/db.js';
import { bucketActivities, timeOnly, dayLabel, fullName, mapsLink } from '../lib/logic.js';

export function Today({ me, seeAll }) {
  const [everyone, setEveryone] = useState(false);
  const { loading, error, data, reload } = useLoad(() => openActivities(everyone ? null : me.id), [everyone]);
  const [hidden, setHidden] = useState(new Set());

  async function done(a) {
    setHidden((s) => new Set(s).add(a.id));
    try { await setActivityDone(a.id, true); toast('Marked done'); }
    catch (e) { setHidden((s) => { const n = new Set(s); n.delete(a.id); return n; }); toast(e.message); }
  }

  const list = (data || []).filter((a) => !hidden.has(a.id));
  const b = bucketActivities(list);

  return html`
    <div class="row between">
      <h2>To do</h2>
      ${seeAll && html`<div class="seg">
        <button class=${!everyone ? 'on' : ''} onClick=${() => setEveryone(false)}>Mine</button>
        <button class=${everyone ? 'on' : ''} onClick=${() => setEveryone(true)}>Everyone</button>
      </div>`}
    </div>
    ${loading && !data ? html`<${Loading} />` : error ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : html`
      <${Section} title="Overdue" items=${b.overdue} onDone=${done} warn showDay />
      <${Section} title="Today" items=${b.today} onDone=${done} empty="Nothing left for today." />
      <${Section} title="Next 7 days" items=${b.upcoming} onDone=${done} showDay />`}
  `;
}

function Section({ title, items, onDone, warn, showDay, empty }) {
  if (!items.length && !empty) return null;
  return html`<section class="stack-sm">
    <h3 class=${warn ? 'warn' : ''}>${title} ${items.length ? html`<span class="count">${items.length}</span>` : ''}</h3>
    ${items.length ? items.map((a) => html`<${Item} key=${a.id} a=${a} onDone=${onDone} showDay=${showDay} />`)
      : html`<p class="muted">${empty}</p>`}
  </section>`;
}

function Item({ a, onDone, showDay }) {
  const phone = a.person?.phones?.[0];
  const address = a.location || a.deal?.site_address;
  const nav = a.type === 'site_appointment' ? mapsLink(address) : null;
  return html`<div class="item">
    <button class="tick" aria-label="Mark done" onClick=${() => onDone(a)}></button>
    <div class="grow">
      <div class="meta">${ACTIVITY_ICON[a.type] || '•'} ${showDay ? dayLabel(a.due_date) + ' · ' : ''}${timeOnly(a.due_at)}</div>
      <a class="title" href=${a.deal_id ? `#/deal/${a.deal_id}` : a.person_id ? `#/contact/${a.person_id}` : null}>${a.subject}</a>
      <div class="muted small">${a.person ? fullName(a.person) : ''}${a.deal && a.person ? ' · ' : ''}${address || ''}</div>
    </div>
    <div class="actions">
      ${phone && html`<a class="icon-btn" href=${'tel:' + phone} aria-label="Call">📞</a>`}
      ${nav && html`<a class="icon-btn" href=${nav} target="_blank" rel="noopener" aria-label="Directions">🧭</a>`}
    </div>
  </div>`;
}
