# CRM

In-house CRM replacing Pipedrive for the solar sales team.

Stack: Supabase (Postgres, auth, storage) + Netlify (web app, installable on phones).

## Build phases

1. **Core CRM** — Booked Appointments pipeline, contacts, site appointments, follow-ups, notes, lost reasons, per-person logins (reps see only their own deals).
2. **Calendar & Projects** — per-person calendar feed (appointments with full address, so phone "Time to Leave" alerts work); installs Projects board.
3. **Email & SMS** — Gmail sync (Google Workspace, Internal app), BCC logging address, post-appointment and follow-up texts via Mobile Message with opt-out.
4. **Switchover** — import from Pipedrive (every row keeps its `pipedrive_id`, so the import can be re-run), repoint Zapier lead feeds, run both side by side 2–3 weeks, then cancel Pipedrive.

## What's built (Phase 1)

- **Today** — your overdue, today and next-7-days activities; tick to mark done; one-tap call and directions. Admin and setter can switch to "Everyone".
- **Pipeline** — Confirmed Appointments → Follow Up → Sold - Awaiting Finance, with totals per column, labels, and a red edge on deals that have sat too long in a stage. Move deals with the arrow buttons.
- **Deal page** — call / text / directions, stage, won or lost (with reason), details and labels, activities, notes.
- **New** — book an appointment: customer, site, date and time (QLD), consultant, setter notes. Creates the contact, the deal and the rep's site appointment in one go.
- **Contacts** — search by name, phone or email; edit details and text/email opt-outs.

The app has no build step: `web/` is plain JavaScript served as-is. Libraries (Preact, htm, supabase-js) load from jsDelivr at pinned versions.

## Setting it up

1. **Supabase**: create a new project (Sydney region). In SQL Editor, paste and run `supabase/schema.sql`.
2. **Config**: copy the Project URL and anon key from Project Settings → API into `web/config.js`.
3. **Netlify**: Add new site → Import from GitHub → this repo. No build settings needed; `netlify.toml` handles it.
4. **Supabase → Authentication → URL Configuration**: set Site URL to your Netlify address.
5. **Add the team**: Authentication → Users → Invite user (they get an email to set a password). Then in SQL Editor:

   ```sql
   insert into profiles (id, full_name, email, role)
   select id, 'Full Name', email, 'rep'          -- admin | setter | rep | installs
   from auth.users where email = 'person@example.com';
   ```

6. On a phone, open the site and use **Share → Add to Home Screen** (iPhone) or **Install app** (Android).

## Checks

```
node --test web/lib/logic.test.js     # business logic (dates, buckets, pipeline)
node web/check-templates.mjs          # every screen template has balanced tags
```

## Database

`supabase/schema.sql` — run once in the Supabase SQL editor on a new project.

Access rules (row-level security) are on for every table:

| Role | Can see |
|---|---|
| admin | everything |
| setter | all leads, deals, contacts, activities |
| rep | only deals they own or are the consultant on, and those customers |
| installs | projects board, plus read access to deals and contacts |
