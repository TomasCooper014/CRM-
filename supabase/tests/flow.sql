-- End-to-end test: lead → booked → won → handover → installed → commission paid,
-- checking what each role can and can't do along the way. Any failure aborts with an error.
\set ON_ERROR_STOP on
\set QUIET on

grant usage on schema public, auth to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema auth, public to authenticated;

insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000e1');
insert into profiles (id, full_name, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Tomas',  'admin@x',  'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'Rep A',  'repa@x',   'rep'),
  ('00000000-0000-0000-0000-0000000000c1', 'Rep B',  'repb@x',   'rep'),
  ('00000000-0000-0000-0000-0000000000d1', 'Sarina', 'setter@x', 'setter'),
  ('00000000-0000-0000-0000-0000000000e1', 'Ops',    'ops@x',    'ops');

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'pass: %', what;
end $$;
create function pg_temp.as_user(suffix text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || suffix, true);
  execute 'set local role authenticated';
end $$;
-- Expect a statement to be refused by the access rules (or to touch nothing).
create function pg_temp.refused(stmt text, what text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute stmt; get diagnostics n = row_count;
  exception when insufficient_privilege or check_violation then n := 0;
  end;
  if n > 0 then raise exception 'FAILED (allowed): %', what; end if;
  raise notice 'pass: refused — %', what;
end $$;

-- ── 1. A WHY Solar lead lands (loaded by admin / integration) ──
insert into people (id, first_name, last_name, phones, postcode)
  values ('10000000-0000-0000-0000-000000000001', 'Larry', 'Friedberg', '{0412345678}', '4305');
insert into leads (id, title, person_id, source, product_interest, suburb, postcode)
  values ('20000000-0000-0000-0000-000000000001', 'Larry Friedberg — Solar & Battery — Wulkuraka 4305',
          '10000000-0000-0000-0000-000000000001', 'WHY Solar', 'Solar & Battery', 'Wulkuraka', '4305');

-- ── 2. Setter works the lead ──
begin;
select pg_temp.as_user('d1');
select pg_temp.check((select count(*) from leads where status = 'new') = 1, 'setter sees the new lead');
insert into activities (type, subject, due_date, done, done_at, outcome, owner_id, lead_id, person_id)
  values ('call', 'Call Larry', current_date, true, now(), 'No answer',
          '00000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
select pg_temp.check((select attempts = 1 and status = 'attempting' and last_outcome = 'No answer' from leads),
                     'logging a call bumps attempts and moves lead to attempting');
update leads set status = 'callback', next_call_at = now() + interval '1 day';
-- books it: deal + rep appointment + lead marked booked
insert into deals (id, title, person_id, owner_id, consultant_id, appointment_at)
  values ('30000000-0000-0000-0000-000000000001', 'Larry Friedberg — Wulkuraka', '10000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', now() + interval '1 day');
insert into activities (type, subject, due_date, owner_id, deal_id, person_id)
  values ('site_appointment', 'Larry — site appointment', current_date + 1, '00000000-0000-0000-0000-0000000000b1',
          '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
update leads set status = 'booked', converted_deal_id = '30000000-0000-0000-0000-000000000001';
select pg_temp.check((select status = 'booked' from leads), 'setter converts lead to a booked appointment');
commit;

-- ── 3. Reps and ops can't touch the lead inbox ──
begin;
select pg_temp.as_user('b1');
select pg_temp.check((select count(*) from leads) = 0, 'rep cannot see the lead inbox');
select pg_temp.as_user('e1');
select pg_temp.check((select count(*) from leads) = 0, 'ops cannot see the lead inbox');
commit;

-- ── 4. Rep sits it and wins it ──
begin;
select pg_temp.as_user('b1');
select pg_temp.check((select count(*) from activities where type = 'site_appointment') = 1, 'rep sees their appointment');
update deals set appointment_outcome = 'Sat & Sold', status = 'won', value_aud = 21873;
select pg_temp.check((select won_at is not null from deals), 'rep marks deal won; won time stamped');
select pg_temp.as_user('c1');
select pg_temp.check((select count(*) from deals) = 0, 'other rep cannot see the deal');
select pg_temp.refused($$update deals set value_aud = 1$$, 'other rep editing the deal');
commit;

-- ── 5. Ops sets up a partner and hands the job over ──
begin;
select pg_temp.as_user('e1');
insert into install_partners (id, name, contact_name, regions)
  values ('40000000-0000-0000-0000-000000000001', 'Sunrise Installs', 'Mick', 'Ipswich, Brisbane West');
select pg_temp.check((select count(*) from deals where status = 'won') = 1, 'ops sees won deals waiting for handover');
insert into projects (id, title, deal_id, person_id, board_id, phase_id, partner_id, handed_over_at,
                      sale_price_aud, commission_aud, finance_provider)
  values ('50000000-0000-0000-0000-000000000001', 'Larry Friedberg — Wulkuraka', '30000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000001', 1, (select id from project_phases where sort_order = 2),
          '40000000-0000-0000-0000-000000000001', now(), 21873, 3200, 'Brighte');
select pg_temp.check((select phase_changed_at is not null and status = 'open' from projects), 'ops creates the handover project');
insert into notes (body, author_id, project_id) values ('Partner confirmed, site inspection Tue', '00000000-0000-0000-0000-0000000000e1',
  '50000000-0000-0000-0000-000000000001');
commit;

-- ── 6. A second handover of the same deal is blocked ──
begin;
select pg_temp.as_user('e1');
do $$ begin
  insert into projects (title, deal_id, board_id, phase_id) values ('dup', '30000000-0000-0000-0000-000000000001', 1, 1);
  raise exception 'FAILED: duplicate handover allowed';
exception when unique_violation then raise notice 'pass: refused — handing the same deal over twice';
end $$;
commit;

-- ── 7. Rep can follow their job; can't change it ──
begin;
select pg_temp.as_user('b1');
select pg_temp.check((select count(*) from projects) = 1, 'rep can see the install status of their sale');
select pg_temp.refused($$update projects set commission_aud = 99999$$, 'rep editing commission');
select pg_temp.refused($$insert into install_partners (name) values ('Rogue')$$, 'rep adding a partner');
select pg_temp.check((select count(*) from install_partners) = 1, 'rep can read the partner list');
select pg_temp.as_user('c1');
select pg_temp.check((select count(*) from projects) = 0, 'other rep cannot see the project');
commit;

-- ── 8. Ops moves it through install to commission paid ──
begin;
select pg_temp.as_user('e1');
update projects set phase_id = (select id from project_phases where name = 'Installed'), install_completed_date = current_date;
select pg_temp.check((select status = 'open' from projects), 'installed but still open until commission is paid');
update projects set phase_id = (select id from project_phases where is_final), commission_paid_on = current_date;
select pg_temp.check((select status = 'completed' from projects), 'final phase completes the project automatically');
update projects set phase_id = (select id from project_phases where name = 'Installed');
select pg_temp.check((select status = 'open' from projects), 'moving back out of the final phase reopens it');
commit;

-- ── 9. Setter can't see the install board; admin sees everything ──
begin;
select pg_temp.as_user('d1');
select pg_temp.check((select count(*) from projects) = 0, 'setter does not see the install board');
select pg_temp.as_user('a1');
select pg_temp.check((select count(*) from projects) = 1 and (select count(*) from leads) = 1 and (select count(*) from deals) = 1,
                     'admin sees leads, deals and projects');
commit;

-- ── 10. Logged out sees nothing ──
begin;
set local role authenticated;
select pg_temp.check((select count(*) from deals) + (select count(*) from people) + (select count(*) from install_partners) = 0,
                     'logged-out user sees nothing');
commit;

\echo ALL FLOW TESTS PASSED
