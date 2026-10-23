import { useState } from '../lib/deps.js';
import { html, useLoad, Loading, ErrorBox, toast } from '../lib/ui.js';
import { openDeals, lookups, updateDeal } from '../lib/db.js';
import { groupByStage, isRotten, fullName, money, when } from '../lib/logic.js';

export function Pipeline({ me, seeAll }) {
  const [everyone, setEveryone] = useState(seeAll);
  const { loading, error, data, reload } = useLoad(
    () => Promise.all([openDeals(everyone ? null : me.id), lookups()]), [everyone]);
  const [moved, setMoved] = useState({}); // optimistic stage moves

  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const [deals, { stages, labels }] = data;
  const view = deals.map((d) => (moved[d.id] ? { ...d, stage_id: moved[d.id], stage_changed_at: new Date().toISOString() } : d));
  const cols = groupByStage(view, stages);
  const labelFor = (id) => labels.find((l) => l.id === id);

  async function move(d, stageId) {
    setMoved((m) => ({ ...m, [d.id]: stageId }));
    try { await updateDeal(d.id, { stage_id: stageId }); toast('Moved'); }
    catch (e) { setMoved((m) => { const n = { ...m }; delete n[d.id]; return n; }); toast(e.message); }
  }

  return html`
    <div class="row between">
      <h2>Pipeline</h2>
      ${seeAll && html`<div class="seg">
        <button class=${!everyone ? 'on' : ''} onClick=${() => setEveryone(false)}>Mine</button>
        <button class=${everyone ? 'on' : ''} onClick=${() => setEveryone(true)}>Everyone</button>
      </div>`}
    </div>
    <div class="board">
      ${cols.map((c, i) => html`<section key=${c.id} class="col">
        <header><strong>${c.name}</strong><span class="muted small">${c.deals.length} · ${money(c.total)}</span></header>
        ${c.deals.map((d) => {
          const rotten = isRotten(d, c);
          return html`<article key=${d.id} class=${'deal' + (rotten ? ' rotten' : '')}>
            <a href=${'#/deal/' + d.id} class="title">${d.title}</a>
            <div class="muted small">${fullName(d.person)}${d.appointment_at ? ' · ' + when(d.appointment_at) : ''}</div>
            <div class="row between small">
              <span>${money(d.value_aud)}${rotten ? html` <span class="warn">· overdue in stage</span>` : ''}</span>
              <span class="tags">${(d.label_ids || []).map(labelFor).filter(Boolean).map((l) => html`<span class=${'tag ' + l.color}>${l.label}</span>`)}</span>
            </div>
            <div class="row move">
              ${i > 0 && html`<button class="small" onClick=${() => move(d, cols[i - 1].id)}>‹ ${cols[i - 1].name}</button>`}
              ${i < cols.length - 1 && html`<button class="small" onClick=${() => move(d, cols[i + 1].id)}>${cols[i + 1].name} ›</button>`}
            </div>
          </article>`;
        })}
        ${!c.deals.length && html`<p class="muted small pad">Empty</p>`}
      </section>`)}
    </div>`;
}
