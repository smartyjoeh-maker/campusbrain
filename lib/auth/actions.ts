"use server";

import { createHmac, createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canRegisterCr, effectiveDashboardRole, isRecordAvailable, isStrongPassword, matchesLecturerRecord, matchesStudentRecord } from "@/lib/auth/policy";
import { getAppBaseUrl } from "@/lib/auth/recovery-url";

type Kind = "student" | "cr" | "lecturer";
type Result = { error?: string; details?: { name: string; registration?: string; programme?: string; phone?: string; gender?: string; qualificationLevel?: string; ticket: string } };
const secret = () => (process.env.REGISTRATION_SIGNING_SECRET?.length ?? 0) >= 32 ? process.env.REGISTRATION_SIGNING_SECRET : undefined;
const rateSecret = () => (process.env.REGISTRATION_RATE_LIMIT_SECRET?.length ?? 0) >= 32 ? process.env.REGISTRATION_RATE_LIMIT_SECRET : undefined;
const norm = (s: string) => s.trim().replace(/\s+/g, " ");
function ticket(id: string, kind: Kind, key: string) {
  const expires = Date.now() + 10 * 60_000;
  const body = `${id}.${kind}.${expires}.${createHash("sha256").update(key.toLowerCase()).digest("hex")}`;
  const sig = createHmac("sha256", secret()!).update(body).digest("hex");
  return Buffer.from(`${body}.${sig}`).toString("base64url");
}
function readTicket(value: string, kind: Kind, key: string) {
  try {
    const [id, actualKind, expires, hash, sig] = Buffer.from(value, "base64url").toString().split(".");
    const body = `${id}.${actualKind}.${expires}.${hash}`;
    const expected = createHmac("sha256", secret()!).update(body).digest("hex");
    if (actualKind !== kind || Number(expires) < Date.now() || hash !== createHash("sha256").update(key.toLowerCase()).digest("hex") || sig !== expected) return null;
    return id;
  } catch { return null; }
}
function identityDigest(identifier: string) {
  return createHmac("sha256", rateSecret()!).update(identifier.trim().toLowerCase()).digest("hex");
}
async function beginAttempt(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, identifier: string) {
  const digest = identityDigest(identifier);
  const { data, error } = await admin.rpc("begin_registration_attempt", { p_identity_hash: digest });
  return { id: typeof data === "string" ? data : null, digest, failed: Boolean(error) };
}
async function finishAttempt(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, id: string, digest: string, succeeded: boolean) {
  const { data, error } = await admin.rpc("finish_registration_attempt", { p_attempt: id, p_identity_hash: digest, p_succeeded: succeeded });
  return !error && data === true;
}

export async function retrieveRecord(form: FormData): Promise<Result> {
  if (!secret() || !rateSecret()) return { error: "Registration is not configured yet. Please contact your institution administrator." };
  const kind = String(form.get("kind")) as Kind;
  if (!["student", "cr", "lecturer"].includes(kind)) return { error: "Choose a valid account type." };
  const admin = createSupabaseAdminClient();
  if (!admin) return { error: "University verification is unavailable until Supabase is configured." };
  if (kind === "lecturer") {
    const phone = norm(String(form.get("phone") ?? "")); const last = norm(String(form.get("lastName") ?? ""));
    if (!phone || !last) return { error: "Enter your phone number and last name." };
    const attempt = await beginAttempt(admin, phone);
    if (attempt.failed) return { error: "Registration verification is temporarily unavailable." };
    if (!attempt.id) return { error: "Too many attempts. Try again in 15 minutes." };
    const { data } = await admin.from("lecturer_records").select("id,last_name,full_name,phone_number,claimed_by").eq("phone_number", phone).maybeSingle();
    if (!data || !isRecordAvailable(data.claimed_by) || !matchesLecturerRecord(data, { phone, lastName: last })) return { error: "We could not verify those details. Check them against your university record." };
    if (!await finishAttempt(admin, attempt.id, attempt.digest, true)) return { error: "Registration verification is temporarily unavailable." };
    return { details: { name: data.full_name, phone: data.phone_number, ticket: ticket(data.id, kind, `${phone}|${last}`) } };
  }
  const registration = norm(String(form.get("registration") ?? "")); const last = norm(String(form.get("lastName") ?? "")); const year = Number(form.get("year"));
  if (!registration || !last || !Number.isInteger(year)) return { error: "Enter your registration number, last name, and year of study." };
  const attempt = await beginAttempt(admin, registration);
  if (attempt.failed) return { error: "Registration verification is temporarily unavailable." };
  if (!attempt.id) return { error: "Too many attempts. Try again in 15 minutes." };
  const { data } = await admin.from("student_records").select("id,last_name,full_name,registration_number,year_of_study,phone_number,gender,qualification_level,claimed_by,authorized_cr,programmes(name)").eq("registration_number", registration).eq("year_of_study", year).maybeSingle();
  if (!data || !isRecordAvailable(data.claimed_by) || !matchesStudentRecord(data, { registration, lastName: last, year }) || (kind === "cr" && !canRegisterCr(data.authorized_cr, data.claimed_by))) return { error: kind === "cr" ? "We could not verify an authorized representative record." : "We could not verify those details. Check them against your university record." };
  if (!await finishAttempt(admin, attempt.id, attempt.digest, true)) return { error: "Registration verification is temporarily unavailable." };
  const programme = Array.isArray(data.programmes) ? data.programmes[0]?.name : (data.programmes as { name: string } | null)?.name;
  const phone = data.phone_number ? `••••${data.phone_number.replace(/\D/g, "").slice(-3)}` : undefined;
  return { details: { name: data.full_name, registration: data.registration_number, programme: programme ?? "", phone, gender: data.gender ?? undefined, qualificationLevel: data.qualification_level ?? undefined, ticket: ticket(data.id, kind, `${registration}|${last}|${year}`) } };
}

export async function completeRegistration(form: FormData): Promise<Result> {
  const kind = String(form.get("kind")) as Kind;
  if (!["student", "cr", "lecturer"].includes(kind)) return { error: "Choose a valid account type." };
  const password = String(form.get("password") ?? ""); const confirm = String(form.get("confirm") ?? "");
  if (!isStrongPassword(password)) return { error: "Use at least 12 characters with upper and lower case letters and a number." };
  if (password !== confirm) return { error: "Passwords do not match." };
  if (!secret() || !rateSecret()) return { error: "Registration is not configured yet." };
  const admin = createSupabaseAdminClient(); if (!admin) return { error: "University verification is unavailable until Supabase is configured." };
  const registration = norm(String(form.get("registration") ?? "")); const phone = norm(String(form.get("phone") ?? ""));
  const last = norm(String(form.get("lastName") ?? "")); const year = Number(form.get("year"));
  const key = kind === "lecturer" ? `${phone}|${last}` : `${registration}|${last}|${year}`;
  const recordId = readTicket(String(form.get("ticket") ?? ""), kind, key);
  if (!recordId) return { error: "Verification expired. Retrieve your record again." };
  const identity = kind === "lecturer" ? phone : registration;
  const email = `${createHash("sha256").update(identity.toLowerCase()).digest("hex")}@accounts.campusbrain.invalid`;
  const table = kind === "lecturer" ? "lecturer_records" : "student_records";
  const { data: rawRecord } = await admin.from(table).select(kind === "lecturer" ? "id,full_name,claimed_by" : "id,full_name,claimed_by,authorized_cr,cr_authorized_by").eq("id", recordId).maybeSingle();
  const record = rawRecord as { id: string; full_name: string; claimed_by: string | null; authorized_cr?: boolean } | null;
  if (!record || record.claimed_by || (kind === "cr" && !record.authorized_cr)) return { error: "This university record is already claimed or no longer authorized." };
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: kind === "lecturer" ? "lecturer" : kind === "cr" ? "cr" : "student" } });
  if (error || !created.user) return { error: "An account already exists for this record, or registration could not be completed." };
  const role = kind === "lecturer" ? "lecturer" : kind === "cr" ? "cr" : "student";
  const { error: profileError } = await admin.from("profiles").insert({ id: created.user.id, role, display_name: record.full_name, identity_key: identity.toLowerCase() });
  if (profileError) {
    const cleanup = await admin.auth.admin.deleteUser(created.user.id);
    if (cleanup.error) return { error: "Registration failed and needs administrator cleanup. Contact support." };
    return { error: "Registration could not be committed. Retrieve your record and try again." };
  }
  const { data: claimed, error: claimError } = await admin.rpc(kind === "lecturer" ? "claim_lecturer" : "claim_student", kind === "lecturer" ? { p_record: recordId, p_user: created.user.id } : { p_record: recordId, p_user: created.user.id, p_is_cr: kind === "cr" });
  if (claimError || claimed !== true) {
    const cleanup = await admin.auth.admin.deleteUser(created.user.id);
    if (cleanup.error) return { error: "Registration failed and needs administrator cleanup. Contact support." };
    return { error: "Registration could not be committed. Retrieve your record and try again." };
  }
  redirect(role === "cr" ? "/dashboard/cr" : role === "lecturer" ? "/dashboard/lecturer" : "/dashboard/student");
}

export async function login(form: FormData): Promise<Result> {
  const type = String(form.get("type")); const identifier = norm(String(form.get("identifier") ?? "")); const password = String(form.get("password") ?? "");
  const client = await createSupabaseServerClient();
  if (!client) return { error: "Login is unavailable until Supabase is configured." };
  const email = type === "admin" ? identifier.toLowerCase() : `${createHash("sha256").update(identifier.toLowerCase()).digest("hex")}@accounts.campusbrain.invalid`;
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { error: "The credentials could not be verified." };
  const { data: user } = await client.auth.getUser();
  const admin = createSupabaseAdminClient();
  if (!admin || !user.user) { await client.auth.signOut(); return { error: "The account could not be verified." }; }
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.user.id).maybeSingle();
  let crAuthorized = false;
  if (profile?.role === "student" || profile?.role === "cr") {
    const { data: studentRecord, error: recordError } = await admin.from("student_records").select("authorized_cr").eq("claimed_by", user.user.id).maybeSingle();
    if (recordError) { await client.auth.signOut(); return { error: "The account could not be verified." }; }
    crAuthorized = studentRecord?.authorized_cr === true;
  }
  const role = profile ? effectiveDashboardRole(profile.role, crAuthorized) : "invalid";
  if (!profile || (type === "admin" && role !== "admin") || (type !== "admin" && role === "admin") || role === "invalid") {
    await client.auth.signOut(); return { error: "This account cannot use that login." };
  }
  redirect(role === "admin" ? "/dashboard/admin" : role === "lecturer" ? "/dashboard/lecturer" : role === "cr" ? "/dashboard/cr" : "/dashboard/student");
}

export async function logout() { const client = await createSupabaseServerClient(); await client?.auth.signOut(); redirect("/login"); }

export async function requestAdminPasswordRecovery(form: FormData): Promise<{ error?: string; success?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid administrator email address." };
  }

  const baseUrl = getAppBaseUrl();
  const client = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!baseUrl || !client || !admin) {
    return { error: "Password recovery is not configured. Please contact your system administrator." };
  }

  // Only provisioned administrator profiles may receive recovery emails.
  // Return the same success response for missing profiles to avoid enumeration.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("identity_key", email)
    .eq("role", "admin")
    .maybeSingle();
  if (profileError) return { error: "We could not process the request right now. Please try again later." };
  if (!profile) {
    return { success: "If this email belongs to a provisioned administrator, a recovery link will be sent shortly." };
  }

  const redirectTo = new URL("/auth/callback?flow=admin-password-recovery", baseUrl).toString();
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return { error: "Email delivery is temporarily rate-limited. Wait before requesting another link, or contact your administrator." };
    }
    return { error: "We could not send a recovery link right now. Please try again later." };
  }

  return { success: "If this email belongs to a provisioned administrator, a recovery link will be sent shortly." };
}

export async function completeAdminPasswordRecovery(form: FormData): Promise<{ error?: string }> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (!isStrongPassword(password)) {
    return { error: "Use at least 12 characters with upper and lower case letters and a number." };
  }
  if (password !== confirm) return { error: "Passwords do not match." };

  const client = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!client || !admin) return { error: "Password recovery is unavailable. Please request a new link." };

  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "This recovery link is invalid or expired. Request a new one." };

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || profile?.role !== "admin") {
    await client.auth.signOut();
    return { error: "This recovery link is not valid for an administrator account." };
  }

  const { error } = await client.auth.updateUser({ password });
  if (error) return { error: "The password could not be updated. Request a new recovery link and try again." };
  redirect("/dashboard/admin");
}
