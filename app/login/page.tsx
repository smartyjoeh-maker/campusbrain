"use client";

import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <aside className="auth-aside"><Brand light /><div className="aside-message"><p className="eyebrow">Welcome to CampusBrain</p><h2>A more connected campus starts here.</h2><p>Keep your campus day moving with clearer classroom coordination and timely lecture updates.</p></div><div className="aside-foot">A shared space for your university community</div></aside>
      <section className="auth-main">
        <div className="auth-main-top"><ThemeToggle /><span>New to CampusBrain? <Link className="inline-link" href="/signup">Create account</Link></span></div>
        <AuthCard eyebrow="Welcome back" title="Log in to your account" description="Use your university credentials to continue.">
          <LoginForm />
          <p className="form-foot"><Link href="/admin/login" className="inline-link">Administrator sign in</Link></p>
        </AuthCard>
      </section>
    </main>
  );
}
