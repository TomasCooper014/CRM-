// Pure business logic — no browser or Supabase imports, so it can be unit-tested in Node.

export const TZ = 'Australia/Brisbane';

/** YYYY-MM-DD for a Date in the business time zone. */
export function localDate(d = new Date(), tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Add whole days to a YYYY-MM-DD string. */
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Split open activities into overdue / today / upcoming, each sorted by time. */
export function bucketActivities(activities, now = new Date(), tz = TZ) {
  const today = localDate(now, tz);
  const out = { overdue: [], today: [], upcoming: [] };
  for (const a of activities) {
    if (a.done) continue;
    if (a.due_date < today) out.overdue.push(a);
    else if (a.due_date === today) out.today.push(a);
    else out.upcoming.push(a);
  }
  const key = (a) => `${a.due_date} ${a.due_at ?? '99'}`;
  for (const k of Object.keys(out)) out[k].sort((x, y) => key(x).localeCompare(key(y)));
  return out;
}

/** Group open deals into columns, in stage order. */
export function groupByStage(deals, stages) {
  const cols = [...stages].sort((a, b) => a.sort_order - b.sort_order).map((s) => ({ ...s, deals: [] }));
  const byId = new Map(cols.map((c) => [c.id, c]));
  for (const d of deals) byId.get(d.stage_id)?.deals.push(d);
  for (const c of cols) {
    c.total = c.deals.reduce((sum, d) => sum + Number(d.value_aud || 0), 0);
    c.deals.sort((a, b) => (a.appointment_at ?? '').localeCompare(b.appointment_at ?? ''));
  }
  return cols;
}

/** A deal is "rotten" when it has sat in its stage longer than the stage allows. */
export function isRotten(deal, stage, now = new Date()) {
  if (!stage?.days_to_rotten) return false;
  const since = new Date(deal.stage_changed_at ?? deal.created_at);
  return (now - since) / 86_400_000 > stage.days_to_rotten;
}

export function fullName(p) {
  if (!p) return '';
  return [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '(no name)';
}

export function money(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number(n || 0));
}

/** "Sat 24 Oct, 10:00 am" in the business time zone. */
export function when(iso, tz = TZ) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

export function timeOnly(iso, tz = TZ) {
  if (!iso) return 'All day';
  return new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function dayLabel(ymd, now = new Date(), tz = TZ) {
  const today = localDate(now, tz);
  if (ymd === today) return 'Today';
  if (ymd === addDays(today, 1)) return 'Tomorrow';
  if (ymd === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Convert a local date + time typed into a form (Brisbane, no daylight saving: UTC+10)
 * into an ISO timestamp. Brisbane's fixed offset keeps this exact.
 */
export function brisbaneToIso(ymd, hhmm) {
  if (!ymd) return null;
  if (!hhmm) return null;
  return new Date(`${ymd}T${hhmm}:00+10:00`).toISOString();
}

/** Normalise an Australian mobile/landline for matching: digits only, 04… / 0X… form. */
export function normalisePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('61') && d.length === 11) d = '0' + d.slice(2);
  return d;
}

/** Map URL to a destination for Google/Apple Maps from an address. */
export function mapsLink(address) {
  return address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null;
}
