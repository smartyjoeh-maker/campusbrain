import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/202611100001_initial_auth_records.sql", import.meta.url), "utf8");

test("migration denies direct table privileges while preserving the admin helper for Storage RLS", () => {
  assert.match(migration, /revoke all privileges on table[\s\S]*from public, anon, authenticated, service_role;/i);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all)\b[^;]*\bon\s+(?:table\s+)?public\.[^;]*\bto\s+authenticated\b/i);
  const authenticatedExecutors = [...migration.matchAll(/grant execute on function ([^;]+) to authenticated;/gi)].map((match) => match[1].trim());
  assert.deepEqual(authenticatedExecutors, ["public.is_admin()"]);
  assert.doesNotMatch(migration, /grant\s+[^;]+\bto\s+anon\b/i);
});

test("bootstrap administrator audit uses an explicit system actor, not the target", () => {
  assert.match(migration, /insert into public\.audit_logs\(actor_id, action, subject_type, subject_id, details\)[\s\S]*?values \([\s\S]*?null,[\s\S]*?'administrator_provisioned'[\s\S]*?'actor_type', 'bootstrap_system'/i);
});

test("all SECURITY DEFINER functions use a constrained search path", () => {
  const definerCount = [...migration.matchAll(/security definer/gi)].length;
  const hardenedCount = [...migration.matchAll(/set search_path = pg_catalog, public, pg_temp/gi)].length;
  assert.ok(definerCount > 0);
  assert.equal(hardenedCount, definerCount);
});

test("claim, CR revocation, and PDF bucket rules are fail closed", () => {
  assert.ok(/p_is_cr and v_role <> 'cr'/i.test(migration), "CR claims check the CR profile role");
  assert.ok(/not p_is_cr and v_role <> 'student'/i.test(migration), "student claims check the student profile role");
  assert.ok(/id = p_user and role = 'lecturer'/i.test(migration), "lecturer claims check the lecturer profile role");
  assert.ok(/revoked_at is null and exists/i.test(migration), "revoked CR rows are hidden from former representatives");
  assert.ok(/on conflict \(id\) do update[\s\S]*public = false/i.test(migration), "bucket conflicts are forced private");
  assert.ok(/for all to authenticated[\s\S]*bucket_id = 'registration-pdfs' and public\.is_admin\(\)/i.test(migration), "Storage policy is restricted to admins");
});

test("rate limiting uses keyed digests and defines retention without pg_cron", () => {
  assert.match(migration, /identity_hash text not null check \(identity_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/i);
  assert.match(migration, /attempted_at < pg_catalog\.now\(\) - interval '30 days'/i);
  assert.doesNotMatch(migration, /create extension[^;]*pg_cron/i);
});
