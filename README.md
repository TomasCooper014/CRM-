# CRM

In-house CRM replacing Pipedrive for the solar sales team.

Stack: Supabase (Postgres, auth, storage) + Netlify (web app, installable on phones).

## Build phases

1. **Core CRM** — Booked Appointments pipeline, contacts, site appointments, follow-ups, notes, lost reasons, per-person logins (reps see only their own deals).
2. **Calendar & Projects** — per-person calendar feed (appointments with full address, so phone "Time to Leave" alerts work); installs Projects board.
3. **Email & SMS** — Gmail sync (Google Workspace, Internal app), BCC logging address, post-appointment and follow-up texts via Mobile Message with opt-out.
4. **Switchover** — import from Pipedrive (every row keeps its `pipedrive_id`, so the import can be re-run), repoint Zapier lead feeds, run both side by side 2–3 weeks, then cancel Pipedrive.

## Database

`supabase/schema.sql` — run once in the Supabase SQL editor on a new project.

Access rules (row-level security) are on for every table:

| Role | Can see |
|---|---|
| admin | everything |
| setter | all leads, deals, contacts, activities |
| rep | only deals they own or are the consultant on, and those customers |
| installs | projects board, plus read access to deals and contacts |
