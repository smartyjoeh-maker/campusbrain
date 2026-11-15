import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AdminLoginPage() {
  return <main className="auth-shell"><aside className="auth-aside"><Brand light /><div className="aside-message"><p className="eyebrow">Private administrator access</p><h2>CampusBrain administration.</h2><p>Manage verified records and institution access.</p></div><div className="aside-foot">Administrator accounts are provisioned privately</div></aside><section className="auth-main"><div className="auth-main-top"><ThemeToggle /><Link className="inline-link" href="/login">User login</Link></div><AuthCard eyebrow="Administrator" title="Sign in" description="Use your provisioned administrator email and password."><LoginForm admin /></AuthCard></section></main>;
}
