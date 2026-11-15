# CampusBrain project instructions

## Product scope
- Build a production-oriented university platform for classroom management and lecture notifications.
- Campus navigation is deferred until verified campus mapping data is available.
- Never invent university names, people, programmes, courses, timetables, venues, records, or lecturer contact details.
- Repository data and credentials must stay fictional. `public/sample-imports/` contains demo-only PDFs, not authentic records.

## Commands
- Setup: `npm install`, then copy `.env.example` to `.env.local`. Full Supabase setup is documented in `README.md`.
- Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Run one test file: `node --experimental-strip-types --test tests/auth-policy.test.ts`.
- Tests use `node:test` and native TypeScript stripping, not Jest or Vitest. Node >= 22.6 is required for `npm test`; the README's Node 20.9 minimum only covers the Next.js app.
- Modules imported directly by tests must use relative `.ts` imports, not `@/` aliases (see `lib/timetable-import.ts`).
- `tests/migration-security.test.ts` and `tests/timetable-permissions.test.ts` assert exact source substrings in SQL/UI files. Update the assertions with intentional refactors, and run the suite before/after so a pre-existing failure is not attributed to your change.

## Architecture
- Next.js App Router project: route UI in `app/`, reusable UI in `components/`, shared domain and integration code in `lib/`.
- `app/dashboard/[role]/page.tsx` is the single dashboard entry. Admin/member sections are selected with `?section=`; the page verifies the session, derives the effective role, and redirects mismatches. Add sections there rather than creating separate dashboard routes.
- Server actions live in `lib/auth/actions.ts`, `lib/admin/actions.ts`, and `lib/timetable/*-actions.ts` with `"use server"`. Client components import them directly; keep authorization and private data access server-side.
- Supabase boundaries: `lib/supabase/server.ts` (cookie-bound anon client), `lib/supabase/admin.ts` (service role), and `lib/supabase/browser.ts` (browser anon client). All return `null` when configuration is missing; preserve graceful redirects/messages instead of throwing.
- Never import the admin client into browser code. Admin actions must re-check `auth.getUser()` and `profiles.role === "admin"`; UI checks are not authorization.
- CR access is not a fixed profile role. Use `effectiveDashboardRole()` from `lib/auth/policy.ts` together with `student_records.authorized_cr`; CRs remain students bound to their programme and year.

## Data, migrations, and security
- Treat every `public` table as private. Migrations enable RLS, revoke privileges from `public, anon, authenticated, service_role`, then grant only the operations the server needs to `service_role`.
- Every `SECURITY DEFINER` function must use `set search_path = pg_catalog, public, pg_temp`. Only `public.is_admin()` may be granted to `authenticated`; service-role RPCs are revoked from all roles and granted back to `service_role`.
- Add ordered timestamped files under `supabase/migrations/`; do not edit already-applied migrations. There is currently no `supabase/config.toml` in this repo despite the README reference.
- `supabase/.temp/` contains CLI link metadata. Treat `supabase link`, `supabase db push`, and migration application as remote operations; confirm the target project ref before running them.
- Registration identities use deterministic internal Auth aliases (`<sha256>@accounts.campusbrain.invalid`). Public forms must never read record tables directly; keep verification, claims, and imports behind server actions and RPCs.
- Imports and timetable publishing must remain atomic RPCs that write the source document, records, status, and audit entry together. Do not add partial-import fallbacks.

## PDF and import workflows
- PDF handling is custom in `lib/pdf-import.ts` and `lib/timetable-import.ts`; there is no OCR integration. Scanned or unparseable PDFs are rejected, and parsers must fail closed rather than guessing columns, groups, lecturers, or sessions.
- Keep the review flow: parse untrusted upload, stage it in private `registration-pdfs`, re-download and re-parse server-side, require an exact preview match, then commit through the RPC. Never trust client-supplied preview rows.
- Storage paths are namespaced (`previews/...`, `timetables/...`). Actions cap uploads at 20 MB; `next.config.ts` raises the server-action body limit to 25 MB, so keep those limits aligned.
- Timetable PDFs are administrator-managed shared imports. Any unparseable programme/year section or missing course/lecturer detail blocks publishing.
- CRs may only add dated emergency sessions for courses in their verified programme and year. Preserve source lecturer names without fabricating phone numbers or Auth identities.
- Regenerate fictional samples with `node scripts/generate-demo-import-pdfs.mjs` and `node scripts/generate-demo-timetable-pdf.mjs`.

## Environment and operations
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `REGISTRATION_SIGNING_SECRET`, and `REGISTRATION_RATE_LIMIT_SECRET` server-only. The two registration secrets must be separate and at least 32 bytes; never expose them through `NEXT_PUBLIC_*`.
- `APP_BASE_URL` must be a bare origin. Auth recovery redirects use `/auth/callback`.
- Provision the first administrator only after creating the Supabase Auth user: set `ADMIN_USER_ID` and `CONFIRM_ADMIN_PROVISIONING=yes`, run `npm run provision-admin`, then unset the confirmation. Never embed or commit a password.
- Maintain accessible, responsive interfaces and persistent user-selected light/dark theme.
- Update this file when project conventions change.
