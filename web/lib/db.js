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
    supabase.from('deals').select('*, person:people(*)').eq('id', id).single().then(check),
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
