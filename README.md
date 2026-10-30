# CRM / Portal

The business's own CRM and team portal: lead → booked appointment → sale → handover to an installation partner → installed → commission paid. Used by appointment setters, sales reps and the operations team.

Stack: Supabase (Postgres, auth, storage) + Netlify (web app, installable on phones). The code and both accounts belong to the business.

## Screens

| Screen | Who | What it does |
|---|---|---|
| **Leads** | setter, admin | Call queue: call-backs due now, new leads (newest first), retries (longest waiting first), booked call-backs. Log No answer / Voicemail / Call back / Not interested, or **Book appointment**. |
| **Book** | setter, rep | Book an appointment: customer, site, date/time (QLD), consultant, notes. From a lead it pre-fills and moves the lead out of the inbox. |
| **Today** | everyone | Overdue, today and next-7-days activities; tick to complete; one-tap call and directions. |
| **Pipeline** | setter, rep, admin | Confirmed Appointments → Follow Up → Sold - Awaiting Finance, with totals and a red edge on deals sitting too long. |
| **Deal** | everyone (reps: own only) | Call / text / directions, stage, won or lost (with reason), details, labels, activities, notes, and installation status once won. |
| **Installs** | ops, admin | Won jobs waiting for handover, then a board per phase: With partner → Site inspection → Finance / deposit → Install booked → Installed → Commission paid. Flags jobs stuck 14+ days and shows unpaid commission. |
| **Handover / Job** | ops, admin | Pick the partner, sale price, commission, finance provider, partner's job number, handover notes; then track install dates and mark commission paid. |
| **Partners** | ops, admin edit; everyone reads | Installation partners and the regions they cover. |
| **Contacts** | everyone (reps: own customers only) | Search by name, phone or email; edit details and text/email opt-outs. |

The app has no build step: `web/` is plain JavaScript served as-is. Libraries (Preact, htm, supabase-js) load from jsDelivr at pinned versions.

## Setting it up

1. **Supabase**: create a new project (Sydney region). In SQL Editor, paste and run `supabase/schema.sql`.
2. **Config**: copy the Project URL and anon key from Project Settings → API into `web/config.js`.
3. **Netlify**: Add new site → Import from GitHub → this repo. No build settings needed; `netlify.toml` handles it.
4. **Supabase → Authentication → URL Configuration**: set Site URL to your Netlify address.
5. **Add the team**: Authentication → Users → Invite user (they get an email to set a password). Then in SQL Editor:

   ```sql
   insert into profiles (id, full_name, email, role)
   select id, 'Full Name', email, 'rep'          -- admin | setter | rep | ops
   from auth.users where email = 'person@example.com';
   ```

6. On a phone, open the site and use **Share → Add to Home Screen** (iPhone) or **Install app** (Android).

## Checks

```
sh supabase/tests/run.sh              # lead → booked → won → handover → commission paid, per role, on a real Postgres
node --test web/lib/logic.test.js     # business logic (dates, call queues, pipeline)
node web/check-templates.mjs          # every screen template has balanced tags
```

## Access rules

Row-level security is on for every table, so these limits hold even if someone calls the database directly:

| Role | Can see and change |
|---|---|
| admin | everything |
| setter | lead inbox, all deals, contacts and activities; not the installs board |
| rep | only deals they own or are the consultant on, those customers, and the install status of their own sales (read-only) |
| ops | won deals, the handover queue, installs board, partners, all contacts and notes; not the lead inbox |

## Build phases

1. **Core CRM + portal flow** — done: leads, booking, pipeline, deals, contacts, handover, installs board, partners.
2. **Calendar** — per-person calendar feed (appointments with full address, so phone "Time to Leave" alerts work).
3. **Email & SMS** — Gmail sync (Google Workspace, Internal app), BCC logging address, post-appointment and follow-up texts via Mobile Message with opt-out.
4. **Data import & switchover** — import from Pipedrive and the old portal export (imported rows keep their source id, so imports can be re-run), repoint the WHY Solar / website / Zapier lead feeds, run side by side, then switch off the old systems.
