import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { AdminPasswordRecoveryForm } from "@/components/admin-password-recovery-form";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function AdminForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const initialError = error === "expired" ? "That recovery link is invalid or expired. Request a new link." : "";

  return (
    <main className="auth-shell">
      <aside className="auth-aside"><Brand light /><div className="aside-message"><p className="eyebrow">Private administrator access</p><h2>Recover your account.</h2><p>We’ll send a password recovery link to the email for your provisioned administrator account.</p></div><div className="aside-foot">Administrator accounts are provisioned privately</div></aside>
      <section className="auth-main">
        <div className="auth-main-top"><ThemeToggle /><Link className="inline-link" href="/admin/login">Administrator sign in</Link></div>
        <AuthCard eyebrow="Administrator" title="Reset your password" description="Enter your administrator email address to request a recovery link.">
          <AdminPasswordRecoveryForm initialError={initialError} />
          <p className="form-foot"><Link href="/admin/login" className="inline-link">Back to administrator sign in</Link></p>
        </AuthCard>
      </section>
    </main>
  );
}
