// All database access lives here, so the screens stay simple.
import { createClient } from './deps.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { localDate, addDays } from './logic.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// ───────── auth & profile ─────────
export async function signIn(email, password) {
  check(await supabase.auth.signInWithPassword({ email, password }));
}
export async function sendReset(email) {
  check(await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin }));
}
export async function setPassword(password) {
  check(await supabase.auth.updateUser({ password }));
}
export async function signOut() {
  await supabase.auth.signOut();
}
export async function myProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return check(await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle());
}
export async function team() {
  return check(await supabase.from('profiles').select('id, full_name, role').eq('active', true).order('full_name'));
}

// ───────── lookups (cached for the session) ─────────
let lookupCache;
export async function lookups() {
  if (!lookupCache) {
    const [stages, lostReasons, labels] = await Promise.all([
      supabase.from('stages').select('*').order('sort_order').then(check),
      supabase.from('lost_reasons').select('*').order('label').then(check),
      supabase.from('labels').select('*').then(check),
    ]);
    lookupCache = { stages, lostReasons, labels };
  }
  return lookupCache;
}

// ───────── activities ─────────
const ACTIVITY_COLS = `id, type, subject, due_date, due_at, done, location, note, owner_id, deal_id, lead_id, person_id,
  deal:deals(id, title, site_address),
  person:people(id, first_name, last_name, phones)`;

/** Open activities up to a week ahead (plus everything overdue). ownerId=null → whole team. */
export async function openActivities(ownerId) {
  const until = addDays(localDate(), 7);
  let q = supabase.from('activities').select(ACTIVITY_COLS).eq('done', false).lte('due_date', until)
    .order('due_date').order('due_at', { nullsFirst: false }).limit(500);
  if (ownerId) q = q.eq('owner_id', ownerId);
  return check(await q);
}
export async function setActivityDone(id, done) {
  check(await supabase.from('activities').update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', id));
}
export async function addActivity(a) {
  return check(await supabase.from('activities').insert(a).select().single());
}

// ───────── deals ─────────
const DEAL_LIST_COLS = `id, title, stage_id, status, value_aud, appointment_at, site_suburb, label_ids,
  stage_changed_at, created_at, owner_id, consultant_id,
  person:people(id, first_name, last_name)`;

export async function openDeals(ownerId) {
  let q = supabase.from('deals').select(DEAL_LIST_COLS).eq('status', 'open').limit(1000);
  if (ownerId) q = q.or(`owner_id.eq.${ownerId},consultant_id.eq.${ownerId}`);
  return check(await q);
}
export async function deal(id) {
  const [d, activities, notes] = await Promise.all([
    supabase.from('deals').select(`*, person:people(*),
      projects(id, status, phase_id, scheduled_install_date, partner:install_partners(name))`).eq('id', id).single().then(check),
    supabase.from('activities').select(ACTIVITY_COLS).eq('deal_id', id).order('due_date', { ascending: false }).then(check),
    supabase.from('notes').select('id, body, created_at, pinned, author:profiles(full_name)').eq('deal_id', id)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }).then(check),
  ]);
  return { ...d, activities, notes };
}
export async function updateDeal(id, patch) {
  return check(await supabase.from('deals').update(patch).eq('id', id).select().single());
}
export async function addNote(note) {
  const { data: { user } } = await supabase.auth.getUser();
  return check(await supabase.from('notes').insert({ ...note, author_id: user.id }).select().single());
}

/** New deal for a new or existing contact, plus an optional site appointment. */
export async function createDeal({ person, personId, deal, appointment }) {
  let pid = personId;
  if (!pid) pid = check(await supabase.from('people').insert(person).select('id').single()).id;
  const created = check(await supabase.from('deals').insert({ ...deal, person_id: pid }).select('id').single());
  if (appointment) {
    await addActivity({ ...appointment, deal_id: created.id, person_id: pid });
  }
  return created.id;
}

// ───────── contacts ─────────
export async function searchPeople(term) {
  let q = supabase.from('people').select('id, first_name, last_name, phones, emails, postcode').limit(50);
  // Strip characters that have meaning in PostgREST filter syntax.
  const t = term.replace(/[,()*{}"\\]/g, ' ').trim();
  if (t) {
    const digits = t.replace(/\D/g, '');
    const parts = [`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`];
    if (digits.length >= 4) parts.push(`phones.cs.{${digits}}`);
    if (t.includes('@')) parts.push(`emails.cs.{${t.toLowerCase()}}`);
    q = q.or(parts.join(','));
  } else {
    q = q.order('created_at', { ascending: false });
  }
  return check(await q);
}
export async function person(id) {
  const [p, deals] = await Promise.all([
    supabase.from('people').select('*').eq('id', id).single().then(check),
    supabase.from('deals').select('id, title, status, stage_id, value_aud, appointment_at').eq('person_id', id)
      .order('created_at', { ascending: false }).then(check),
  ]);
  return { ...p, deals };
}
export async function updatePerson(id, patch) {
  return check(await supabase.from('people').update(patch).eq('id', id).select().single());
}

async function me() {
  const { data: { user } } = await supabase.auth.getUser();
  return user.id;
}

// ───────── lead inbox (setters) ─────────
const LEAD_COLS = `id, title, source, product_interest, suburb, postcode, notes, status, attempts, last_outcome,
  last_attempt_at, next_call_at, created_at, person:people(id, first_name, last_name, phones, emails, bill_size)`;

export async function leadInbox() {
  return check(await supabase.from('leads').select(LEAD_COLS).eq('archived', false)
    .in('status', ['new', 'attempting', 'callback']).order('created_at', { ascending: false }).limit(500));
}
export async function lead(id) {
  return check(await supabase.from('leads').select(LEAD_COLS).eq('id', id).single());
}

/**
 * Record a call on a lead. result: 'No answer' | 'Left voicemail' | 'Call back' | 'Not interested'.
 * The database bumps the attempt count; this sets the lead's status to match the result.
 */
export async function logLeadCall(l, result, { nextCallAt = null, note = null } = {}) {
  const uid = await me();
  const activityOutcome = result === 'No answer' || result === 'Left voicemail' ? result : 'Connected';
  check(await supabase.from('activities').insert({
    type: 'call', subject: `Call — ${result}`, due_date: new Date().toISOString().slice(0, 10),
    done: true, done_at: new Date().toISOString(), outcome: activityOutcome, note,
    owner_id: uid, lead_id: l.id, person_id: l.person?.id ?? null,
  }));
  const patch = { last_outcome: result };
  if (result === 'Call back') Object.assign(patch, { status: 'callback', next_call_at: nextCallAt });
  if (result === 'Not interested') Object.assign(patch, { status: 'dead', dead_reason: note || 'Not interested' });
  check(await supabase.from('leads').update(patch).eq('id', l.id));
}
export async function addLead({ person, lead: l }) {
  const p = check(await supabase.from('people').insert(person).select('id').single());
  return check(await supabase.from('leads').insert({ ...l, person_id: p.id, owner_id: await me() }).select('id').single()).id;
}
export async function markLeadBooked(id, dealId) {
  check(await supabase.from('leads').update({ status: 'booked', converted_deal_id: dealId }).eq('id', id));
}

// ───────── installation partners ─────────
export async function partners(includeInactive = false) {
  let q = supabase.from('install_partners').select('*').order('name');
  if (!includeInactive) q = q.eq('active', true);
  return check(await q);
}
export async function savePartner(p) {
  const { id, ...fields } = p;
  return id
    ? check(await supabase.from('install_partners').update(fields).eq('id', id).select().single())
    : check(await supabase.from('install_partners').insert(fields).select().single());
}

// ───────── handover & installs board (ops) ─────────
/** Won deals that haven't been handed to a partner yet. */
export async function handoverQueue() {
  const rows = check(await supabase.from('deals')
    .select('id, title, value_aud, won_at, site_suburb, consultant_id, person:people(first_name, last_name), projects(id, status)')
    .eq('status', 'won').order('won_at', { ascending: true }).limit(500));
  return rows.filter((d) => !d.projects.some((p) => p.status !== 'canceled'));
}
export async function phases() {
  return check(await supabase.from('project_phases').select('*').eq('board_id', 1).order('sort_order'));
}
const PROJECT_LIST_COLS = `id, title, phase_id, status, phase_changed_at, handed_over_at, scheduled_install_date,
  sale_price_aud, commission_aud, commission_paid_on, partner:install_partners(id, name), deal_id`;

/** Open projects plus anything completed in the last 60 days. */
export async function projectBoard() {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  return check(await supabase.from('projects').select(PROJECT_LIST_COLS)
    .or(`status.eq.open,and(status.eq.completed,phase_changed_at.gte.${since})`).limit(1000));
}
export async function project(id) {
  const [p, notes] = await Promise.all([
    supabase.from('projects').select(`*, partner:install_partners(*), person:people(*),
      deal:deals(id, title, value_aud, site_address, site_suburb, site_postcode, consultant_id, proposal_url, job_pack_url)`)
      .eq('id', id).single().then(check),
    supabase.from('notes').select('id, body, created_at, author:profiles(full_name)').eq('project_id', id)
      .order('created_at', { ascending: false }).then(check),
  ]);
  return { ...p, notes };
}
export async function handOver(deal, fields) {
  const ph = await phases();
  return check(await supabase.from('projects').insert({
    title: deal.title, deal_id: deal.id, person_id: deal.person?.id ?? null, board_id: 1,
    phase_id: ph.find((x) => x.sort_order === 2)?.id ?? ph[0].id, // straight to "With partner"
    handed_over_at: new Date().toISOString(), owner_id: await me(), ...fields,
  }).select('id').single()).id;
}
export async function updateProject(id, patch) {
  return check(await supabase.from('projects').update(patch).eq('id', id).select().single());
}
