# CampusBrain

University technology platform for classroom management and lecture notifications. Campus navigation is deferred until verified mapping information is available.

## Getting started

1. Install Node.js 20.9 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and add Supabase project values when available.
4. Run `npm run dev` and open the local URL shown in the terminal.

The application includes server verified registration and protected dashboards. Real registration remains unavailable until the institution configures Supabase and imports its own verified records. Never add real university data or credentials to this repository.

## Supabase setup

1. Create a Supabase project and configure the environment variables from `.env.example` in a local `.env.local` file. Set `APP_BASE_URL` to the CampusBrain site origin in production. Find the project reference in the Supabase project URL: for `https://<ref>.supabase.co`, it is `<ref>`; the dashboard also shows it in `/project/<ref>`. Confirm that reference against the intended project before linking or applying migrations. The root `project_id` in `supabase/config.toml` identifies the local CLI project; it does not itself link or guarantee the remote target. A reference can be stored as plain configuration, but the CLI links the remote explicitly with `supabase link --project-ref <confirmed-ref>`. Do not guess it or substitute the project display name. Generate separate random values for `REGISTRATION_SIGNING_SECRET` and `REGISTRATION_RATE_LIMIT_SECRET`. In PowerShell, generate a 48-byte rate-limit secret without printing it by assigning the result to `$secret`:

   ```powershell
   $bytes = New-Object byte[] 48
   $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
   try { $rng.GetBytes($bytes); $secret = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant() } finally { $rng.Dispose() }
   ```

   Paste `$secret` into the empty `REGISTRATION_RATE_LIMIT_SECRET` entry in `.env.local`. If the entry already has a value, preserve it. Never print or commit the value. `REGISTRATION_RATE_LIMIT_SECRET` is read only in the server action in `lib/auth/actions.ts`; it is not prefixed with `NEXT_PUBLIC_` or imported into browser code. Keep `SUPABASE_SERVICE_ROLE_KEY` server only.
2. Apply migrations `202611100001_initial_auth_records.sql` through `202611110001_admin_timetable_emergency_sessions.sql` in timestamp order using the Supabase CLI. They create private records and PDF storage, registration details, timetable support, and CR emergency sessions. The newest migration moves timetable publishing to administrators and disables the former CR timetable publishing RPC.
3. Create the first administrator through Supabase Auth using a private, controlled method. Set `ADMIN_USER_ID` and `CONFIRM_ADMIN_PROVISIONING=yes`, then run `npm run provision-admin`; unset the confirmation afterwards. This script never creates or embeds a password.
4. Sign in at `/admin/login`, import text based registration PDFs, inspect the parsed rows, and explicitly confirm each import. Student rows use registration, last name, full name, year, programme, and may include gender, phone, UQF level, and a `CR` or `NO` marker. Lecturer rows use last name, full name, phone, and may include semicolon separated `courseCode~courseName~programme` assignments. Scanned PDFs require an OCR integration and are rejected with a clear message.
5. CR markers in an administrator reviewed PDF grant CR access only after the administrator confirms the import. Otherwise authorize or revoke CR eligibility from the Students & CRs dashboard.

Fictional, clearly labeled import samples are available under `public/sample-imports/`. They contain placeholder `DEMO` student identities and invalid `+000` phone numbers; never use them as authentic university records. The student sample has 20 first-year rows, of which two request CR authorization at import confirmation. The lecturer sample uses abbreviated lecturer names, course names/codes, and the programme copied from the user-provided timetable, while retaining invalid placeholder phones. It has no valid lecturer contact information and is only suitable for parser demonstration. Regenerate them locally with `node scripts/generate-demo-import-pdfs.mjs`.

Only administrators can upload and publish department timetable PDFs from the Timetables section. The review step extracts each supported programme/year group, course catalog, lecturer names, and scheduled sessions; all parsed groups must pass validation before the server re-reads the staged private PDF and publishes the import in one audited transaction. Course codes are scoped to programmes, and lecturer names are kept as source data without inventing lecturer phone numbers or Auth records. The timetable PDF remains in the private `registration-pdfs` bucket. Students and CRs see the schedule for their verified programme and year. CRs have no timetable upload or publish controls. A CR can add a dated, one-time emergency class session for a course in their programme; the server verifies active CR authorization and programme ownership, and the session is shown only to students in that programme and year. Text-based grid PDFs are supported. Scanned PDFs require OCR, and any section the parser cannot safely identify blocks publishing so it is not silently omitted. A fictional, clearly marked grid sample is at `public/sample-imports/campusbrain-demo-timetable.pdf`; regenerate it with `node scripts/generate-demo-timetable-pdf.mjs`.

Administrator password recovery is available at `/admin/forgot-password`. It sends a Supabase Auth recovery email only when the submitted email belongs to a provisioned administrator profile, then exchanges the one-time callback code before allowing a new password. Add `http://localhost:3000/auth/callback*` and `<APP_BASE_URL>/auth/callback*` to the project's Auth redirect URL allowlist. Configure custom SMTP under Supabase Authentication settings for reliable delivery; the built-in email sender is limited and intended for testing.

Student and lecturer accounts use deterministic internal Supabase Auth email aliases derived from their registration number or phone; login forms accept the original identifier. Passwords are handled by Supabase Auth and are never stored by CampusBrain. Administrators sign in separately with their Auth email.

The service role is used only by server-only modules and protected server actions. The migration grants no table privileges to `anon` or `authenticated`; service role receives only the table operations used by the application and provisioning script. RLS policies remain enabled as defense in depth, and authenticated users retain only the `is_admin()` execution permission needed by the private Storage policy. Registration verification returns only a match and short lived signed ticket; account creation rechecks role, claim state, and CR authorization in transaction-backed functions. Private registration tables have RLS, and registration attempts are rate limited in PostgreSQL using a keyed digest. The attempt table retains up to 30 days; configure a trusted scheduled invocation of `public.prune_registration_attempts()` to remove older rows. The migration does not assume `pg_cron` is installed. Bootstrap administrator provisioning is recorded with a null `actor_id` and `actor_type=bootstrap_system`, identifying a system action without attributing it to the target administrator. PDF parsing supports text streams and explicit pipe or tab delimited rows; it is intentionally review-first and does not guess document columns. Import writes, document status, and audit entries commit together; failed transactions leave no partial database import.

## Structure

- `app/`: App Router pages and global styles
- `components/`: shared shell, theme controls, and UI
- `lib/`: shared utilities and Supabase client boundaries
- `AGENTS.md`: project-specific implementation guidance
