import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.ADMIN_USER_ID;
if (!url || !key || !userId || process.env.CONFIRM_ADMIN_PROVISIONING !== "yes") {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_USER_ID, and CONFIRM_ADMIN_PROVISIONING=yes. Create the administrator through Supabase Auth first.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: { user }, error: authError } = await supabase.auth.admin.getUserById(userId);
if (authError || !user?.email) { console.error("ADMIN_USER_ID must identify an existing Auth user with an email."); process.exit(1); }
const { data: provisioned, error } = await supabase.rpc("provision_admin_profile", { p_user: user.id });
if (error || provisioned !== true) { console.error(error?.message ?? "Administrator profile could not be provisioned."); process.exit(1); }
console.log(`Administrator profile provisioned for ${user.email}.`);
