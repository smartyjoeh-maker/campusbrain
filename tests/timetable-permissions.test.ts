import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/202611110001_admin_timetable_emergency_sessions.sql", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../app/dashboard/[role]/page.tsx", import.meta.url), "utf8");
const memberUi = readFileSync(new URL("../components/member-dashboard.tsx", import.meta.url), "utf8");
const adminActions = readFileSync(new URL("../lib/timetable/admin-actions.ts", import.meta.url), "utf8");
const emergencyActions = readFileSync(new URL("../lib/timetable/emergency-actions.ts", import.meta.url), "utf8");

test("timetable publishing RPC is administrator-only and former CR RPC is removed", () => {
  assert.match(migration, /drop function if exists public\.commit_cr_timetable/i);
  assert.match(migration, /create or replace function public\.commit_admin_timetable_import/i);
  assert.match(migration, /p\.id\s*=\s*p_actor and p\.role\s*=\s*'admin'/i);
  assert.match(migration, /grant execute on function public\.commit_admin_timetable_import[\s\S]*to service_role/i);
  assert.match(adminActions, /profile\?\.role === "admin"/);
  assert.match(dashboard, /"timetables"/);
  assert.doesNotMatch(memberUi, /CrTimetableUpload|publish timetable/i);
});

test("emergency session RPC validates current CR authorization and programme ownership", () => {
  assert.match(migration, /create or replace function public\.commit_cr_emergency_session/i);
  assert.match(migration, /s\.claimed_by=p_actor and s\.authorized_cr and p\.role in \('student','cr'\)/i);
  assert.match(migration, /c\.id=p_course_id and c\.programme_id=v_student\.programme_id/i);
  assert.match(emergencyActions, /commit_cr_emergency_session/);
  assert.match(memberUi, /EmergencySchedule isCr=\{isCr\}/);
  assert.match(dashboard, /emergency_schedule_entries/);
});
