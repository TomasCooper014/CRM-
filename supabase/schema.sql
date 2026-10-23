-- XF / Ghost Sales CRM — Phase 1 database schema (Supabase / Postgres)
-- Mirrors the live Pipedrive setup: Booked Appointments pipeline, custom fields,
-- lost reasons, labels, activity types, and the installs Projects board.
-- Every imported row keeps its pipedrive_id so the migration can be re-run safely.

create extension if not exists "pgcrypto";

-- ───────────────────────── Team ─────────────────────────
create type user_role as enum ('admin', 'setter', 'rep', 'installs');

create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  full_name     text not null,
  email         text unique not null,
  phone         text,
  role          user_role not null default 'rep',
  timezone      text not null default 'Australia/Brisbane',
  calendar_token uuid not null default gen_random_uuid(), -- private ICS feed link
  gmail_connected boolean not null default false,
  active        boolean not null default true,
  pipedrive_user_id bigint unique,
  created_at    timestamptz not null default now()
);

-- ───────────────────────── Lookups ─────────────────────────
create table stages (
  id          serial primary key,
  name        text not null,
  sort_order  int not null,
  days_to_rotten int
);
insert into stages (name, sort_order, days_to_rotten) values
  ('Confirmed Appointments', 1, 2),
  ('Follow Up',              2, 7),
  ('Sold - Awaiting Finance',3, 7);

create table lost_reasons (
  id     serial primary key,
  label  text unique not null,
  reengage boolean not null default false  -- eligible for win-back emails/texts
);
insert into lost_reasons (label, reengage) values
  ('Did Not Answer (DNA)', true),
  ('Duplicate Lead', false),
  ('Wants A Cheap System', false),
  ('Gone With A Competitor', false),
  ('Not Interested', false),
  ('Change Of Mind', true),
  ('Does Not Want To Be Contacted - DNC', false),
  ('Wrong Number - Sent email no reply', false),
  ('Not The Homeowner', false),
  ('Roof Too Small - Less than 10 panels', false),
  ('No Answer (After 3 Attempts)', true),
  ('DNQ', false),
  ('Ghosted - No response or gone cold', true),
  ('Reschedule - Booked Sales', false),
  ('S.E.A', false);

create table labels (
  id     serial primary key,
  scope  text not null check (scope in ('deal','person','project')),
  label  text not null,
  color  text,
  unique (scope, label)
);
insert into labels (scope, label, color) values
  ('deal','Hot','red'), ('deal','Warm','yellow'), ('deal','Hot Follow-Up','red'),
  ('deal','DNQ','pink'), ('deal','OFA','dark-gray'), ('deal','Site Inspection','blue'),
  ('deal','Email Quotes Only','orange'), ('deal','Maintenance Jobs','pink'),
  ('person','Customer','green'), ('person','Hot lead','red'), ('person','Warm lead','yellow'),
  ('person','Cold lead','blue'), ('person','DNC','red'), ('person','OFA','dark-gray'), ('person','DNQ','pink'),
  ('project','Site inspection','orange'), ('project','Pending Deposit','brown'),
  ('project','Deposit Paid','purple'), ('project','FINANCE APPROVED','dark-gray'),
  ('project','No installer','pink'), ('project','Waiting on more info from rep','pink'),
  ('project','Cancel Project','red'), ('project','On hold','yellow');

-- ───────────────────────── Contacts ─────────────────────────
create type marketing_status as enum ('no_consent','subscribed','unsubscribed','bounced');

create table people (
  id            uuid primary key default gen_random_uuid(),
  first_name    text,
  last_name     text,
  phones        text[] not null default '{}',
  emails        text[] not null default '{}',
  postal_address text,
  postcode      text,
  owner_id      uuid references profiles,
  label_ids     int[] not null default '{}',
  bill_size     text,
  system_interest text,
  what_matters_most text,
  ad_campaign_type text, ad_source text, landing_page text,
  campaign_name text, ad_set_name text, ad_name text,
  marketing_status marketing_status not null default 'no_consent',
  sms_opt_out   boolean not null default false,   -- set when they reply STOP
  email_opt_out boolean not null default false,
  pipedrive_id  bigint unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on people using gin (emails);
create index on people using gin (phones);

-- ───────────────────────── Leads (setter inbox, pre-deal) ─────────────────────────
create table leads (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  person_id   uuid references people on delete cascade,
  owner_id    uuid references profiles,          -- usually the setter
  source      text,                              -- Response Boss, WHY Solar, Energet, website…
  notes       text,
  archived    boolean not null default false,
  converted_deal_id uuid,
  pipedrive_id text unique,                      -- Pipedrive lead ids are UUIDs
  created_at  timestamptz not null default now()
);

-- ───────────────────────── Deals ─────────────────────────
create type deal_status as enum ('open','won','lost');
create type appointment_outcome as enum (
  'Sat','Single Legger F/Up','F/Up','Special Approval','New Build','Sat & Sold',
  'Reschedule - No Show/On The Door','Sat but Not Sold','DNQ','Cancellation');

create table deals (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  person_id     uuid references people,
  owner_id      uuid references profiles,
  consultant_id uuid references profiles,        -- "Solar Consultant"
  stage_id      int not null references stages default 1,
  status        deal_status not null default 'open',
  lost_reason_id int references lost_reasons,
  lost_note     text,
  value_aud     numeric(12,2) not null default 0,
  label_ids     int[] not null default '{}',
  -- site
  site_address  text,
  site_suburb   text,
  site_state    text,
  site_postcode text,
  site_lat      double precision,
  site_lng      double precision,
  -- appointment
  appointment_at   timestamptz,
  appointment_types text[] not null default '{}', -- Single Legger, Both Homeowners, Zoom, Phone Consultation
  home_owner    text check (home_owner in ('Own','Rent')),
  appointment_outcome appointment_outcome,
  -- links & attribution
  job_pack_url  text,
  proposal_url  text,
  quote_id      text,                            -- link to XF quote tool
  campaign      text,
  lead_source   text,
  ad_source text, landing_page text, ad_set_name text, ad_name text,
  -- lifecycle
  stage_changed_at timestamptz,
  won_at        timestamptz,
  lost_at       timestamptz,
  pipedrive_id  bigint unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on deals (owner_id, status);
create index on deals (consultant_id, status);
create index on deals (stage_id) where status = 'open';

-- ───────────────────────── Activities ─────────────────────────
create type activity_type as enum (
  'site_appointment','follow_up','call','meeting','task','email',
  'virtual_appointment','send_job_pack','installation','message');
create type activity_outcome as enum (
  'Connected','Left voicemail','No answer','Completed','Rescheduled','No show','Cancelled');

create table activities (
  id          uuid primary key default gen_random_uuid(),
  type        activity_type not null,
  subject     text not null,
  due_at      timestamptz,            -- null time = all-day on due_date
  due_date    date not null,
  duration    interval,
  done        boolean not null default false,
  done_at     timestamptz,
  outcome     activity_outcome,
  priority    text check (priority in ('Low','Medium','High')),
  location    text,
  note        text,
  owner_id    uuid references profiles,
  deal_id     uuid references deals on delete cascade,
  lead_id     uuid references leads on delete cascade,
  person_id   uuid references people,
  project_id  uuid,
  busy        boolean not null default true,
  pipedrive_id bigint unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on activities (owner_id, due_date) where not done;
create index on activities (deal_id);

-- ───────────────────────── Notes ─────────────────────────
create table notes (
  id         uuid primary key default gen_random_uuid(),
  body       text not null,
  author_id  uuid references profiles,
  deal_id    uuid references deals on delete cascade,
  lead_id    uuid references leads on delete cascade,
  person_id  uuid references people on delete cascade,
  project_id uuid,
  pinned     boolean not null default false,
  pipedrive_id bigint unique,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Projects (installs board) ─────────────────────────
create table project_boards (
  id    serial primary key,
  name  text not null,
  pipedrive_id bigint unique
);
create table project_phases (
  id        serial primary key,
  board_id  int not null references project_boards on delete cascade,
  name      text not null,
  sort_order int not null,
  pipedrive_id bigint unique
);

create table projects (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  board_id     int references project_boards,
  phase_id     int references project_phases,
  deal_id      uuid references deals,
  person_id    uuid references people,
  owner_id     uuid references profiles,
  status       text not null default 'open' check (status in ('open','completed','canceled')),
  health       text check (health in ('On track','At risk','Off track','On hold')),
  label_ids    int[] not null default '{}',
  scheduled_install_date date,
  install_completed_date date,
  assigned_installer text,
  installation_notes text,
  start_date   date,
  end_date     date,
  pipedrive_id bigint unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table activities add constraint activities_project_fk
  foreign key (project_id) references projects on delete cascade;
alter table notes add constraint notes_project_fk
  foreign key (project_id) references projects on delete cascade;

-- ───────────────────────── Messages (Phase 3) ─────────────────────────
create table email_messages (
  id            uuid primary key default gen_random_uuid(),
  gmail_message_id text unique,
  gmail_thread_id  text,
  direction     text not null check (direction in ('in','out')),
  from_address  text not null,
  to_addresses  text[] not null default '{}',
  cc_addresses  text[] not null default '{}',
  subject       text,
  snippet       text,
  body_html     text,
  sent_at       timestamptz not null,
  mailbox_owner_id uuid references profiles,
  person_id     uuid references people,
  deal_id       uuid references deals,
  created_at    timestamptz not null default now()
);
create index on email_messages (deal_id, sent_at desc);

create table sms_messages (
  id          uuid primary key default gen_random_uuid(),
  direction   text not null check (direction in ('in','out')),
  to_number   text not null,
  from_number text,
  body        text not null,
  status      text,                       -- queued / sent / delivered / failed
  provider_id text,
  automation  text,                       -- e.g. 'post_appointment', 'quote_followup'
  person_id   uuid references people,
  deal_id     uuid references deals,
  sent_by     uuid references profiles,
  created_at  timestamptz not null default now()
);

-- ───────────────────────── Audit trail ─────────────────────────
create table change_log (
  id          bigserial primary key,
  table_name  text not null,
  row_id      uuid not null,
  changed_by  uuid references profiles,
  changes     jsonb not null,
  changed_at  timestamptz not null default now()
);

-- ───────────────────────── updated_at triggers ─────────────────────────
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger t_people   before update on people     for each row execute function touch_updated_at();
create trigger t_deals    before update on deals      for each row execute function touch_updated_at();
create trigger t_acts     before update on activities for each row execute function touch_updated_at();
create trigger t_projects before update on projects   for each row execute function touch_updated_at();

create or replace function deal_stage_changed() returns trigger language plpgsql as $$
begin
  if new.stage_id is distinct from old.stage_id then new.stage_changed_at := now(); end if;
  if new.status = 'won'  and old.status <> 'won'  then new.won_at  := now(); end if;
  if new.status = 'lost' and old.status <> 'lost' then new.lost_at := now(); end if;
  return new;
end $$;
create trigger t_deal_stage before update on deals for each row execute function deal_stage_changed();

-- ───────────────────────── Access rules (RLS) ─────────────────────────
-- admin & setter: everything. rep: own/consulting deals + linked records. installs: projects.
create or replace function my_role() returns user_role language sql stable security definer as $$
  select role from profiles where id = auth.uid() and active
$$;

alter table profiles       enable row level security;
alter table people         enable row level security;
alter table leads          enable row level security;
alter table deals          enable row level security;
alter table activities     enable row level security;
alter table notes          enable row level security;
alter table projects       enable row level security;
alter table email_messages enable row level security;
alter table sms_messages   enable row level security;

create policy profiles_read on profiles for select using (auth.uid() is not null);
create policy profiles_admin on profiles for all using (my_role() = 'admin');

create policy deals_staff on deals for all using (my_role() in ('admin','setter'));
create policy deals_rep on deals for all
  using (my_role() = 'rep' and (owner_id = auth.uid() or consultant_id = auth.uid()));
create policy deals_installs_read on deals for select using (my_role() = 'installs');

create policy people_staff on people for all using (my_role() in ('admin','setter','installs'));
create policy people_rep on people for select using (
  my_role() = 'rep' and exists (
    select 1 from deals d where d.person_id = people.id
      and (d.owner_id = auth.uid() or d.consultant_id = auth.uid())));

create policy leads_staff on leads for all using (my_role() in ('admin','setter'));

create policy acts_staff on activities for all using (my_role() in ('admin','setter'));
create policy acts_own on activities for all using (owner_id = auth.uid());
create policy acts_rep_deal on activities for select using (
  my_role() = 'rep' and exists (
    select 1 from deals d where d.id = activities.deal_id
      and (d.owner_id = auth.uid() or d.consultant_id = auth.uid())));

create policy notes_staff on notes for all using (my_role() in ('admin','setter'));
create policy notes_rep on notes for all using (
  my_role() = 'rep' and exists (
    select 1 from deals d where d.id = notes.deal_id
      and (d.owner_id = auth.uid() or d.consultant_id = auth.uid())));
create policy notes_installs on notes for all using (my_role() = 'installs' and project_id is not null);

create policy projects_team on projects for all using (my_role() in ('admin','installs'));
create policy projects_rep_read on projects for select using (
  my_role() = 'rep' and exists (
    select 1 from deals d where d.id = projects.deal_id
      and (d.owner_id = auth.uid() or d.consultant_id = auth.uid())));

create policy email_staff on email_messages for all using (my_role() in ('admin','setter'));
create policy email_own on email_messages for select using (mailbox_owner_id = auth.uid());
create policy sms_staff on sms_messages for all using (my_role() in ('admin','setter'));

-- Lookup tables: any signed-in team member can read; only admin can change.
alter table stages         enable row level security;
alter table lost_reasons   enable row level security;
alter table labels         enable row level security;
alter table project_boards enable row level security;
alter table project_phases enable row level security;
alter table change_log     enable row level security;

create policy stages_read   on stages         for select using (my_role() is not null);
create policy stages_admin  on stages         for all    using (my_role() = 'admin');
create policy lost_read     on lost_reasons   for select using (my_role() is not null);
create policy lost_admin    on lost_reasons   for all    using (my_role() = 'admin');
create policy labels_read   on labels         for select using (my_role() is not null);
create policy labels_admin  on labels         for all    using (my_role() = 'admin');
create policy boards_read   on project_boards for select using (my_role() is not null);
create policy boards_admin  on project_boards for all    using (my_role() = 'admin');
create policy phases_read   on project_phases for select using (my_role() is not null);
create policy phases_admin  on project_phases for all    using (my_role() = 'admin');
create policy changelog_admin on change_log   for select using (my_role() = 'admin');
