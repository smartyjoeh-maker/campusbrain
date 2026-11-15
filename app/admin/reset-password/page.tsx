import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPasswordResetForm } from "@/components/admin-password-recovery-form";
import { AuthCard } from "@/components/auth-card";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminResetPasswordPage() {
  const client = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!client || !admin) redirect("/admin/forgot-password?error=expired");

  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/admin/forgot-password?error=expired");
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error || profile?.role !== "admin") redirect("/admin/login");

  return (
    <main className="auth-shell">
      <aside className="auth-aside"><Brand light /><div className="aside-message"><p className="eyebrow">Private administrator access</p><h2>Choose a new password.</h2><p>Your password is handled securely by Supabase Auth.</p></div><div className="aside-foot">Administrator accounts are provisioned privately</div></aside>
      <section className="auth-main">
        <div className="auth-main-top"><ThemeToggle /><Link className="inline-link" href="/admin/login">Administrator sign in</Link></div>
        <AuthCard eyebrow="Administrator" title="Set a new password" description="Choose a strong password for your CampusBrain administrator account.">
          <AdminPasswordResetForm />
        </AuthCard>
      </section>
    </main>
  );
}
