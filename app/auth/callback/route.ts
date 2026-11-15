import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/auth/recovery-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl) return new NextResponse("Password recovery is not configured.", { status: 503 });

  const requestUrl = new URL(request.url);
  const failureUrl = new URL("/admin/forgot-password?error=expired", baseUrl);
  if (requestUrl.searchParams.get("flow") !== "admin-password-recovery") {
    return NextResponse.redirect(new URL("/admin/login", baseUrl));
  }

  const code = requestUrl.searchParams.get("code");
  const client = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!code || !client || !admin) return NextResponse.redirect(failureUrl);

  const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
  if (exchangeError) return NextResponse.redirect(failureUrl);

  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.redirect(failureUrl);
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error || profile?.role !== "admin") {
    await client.auth.signOut();
    return NextResponse.redirect(new URL("/admin/login", baseUrl));
  }

  return NextResponse.redirect(new URL("/admin/reset-password", baseUrl));
}
