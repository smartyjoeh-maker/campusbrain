import Link from "next/link";
import { ArrowRight, GraduationCap, UserRound, UsersRound } from "lucide-react";
import { AuthCard } from "@/components/auth-card";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const roles = [
  { title: "Student", detail: "Access your campus schedule and updates", icon: GraduationCap },
  { title: "Class representative", detail: "Coordinate your programme and classmates", icon: UsersRound },
  { title: "Lecturer", detail: "Manage lecture attendance updates", icon: UserRound },
];

export default function SignupPage() {
  return (
    <main className="auth-shell">
      <aside className="auth-aside"><Brand light /><div className="aside-message"><p className="eyebrow">Get started</p><h2>Your campus community, all in sync.</h2><p>Choose your role to see the right next step for joining CampusBrain.</p></div><div className="aside-foot">Secure access begins with verified university records</div></aside>
      <section className="auth-main">
        <div className="auth-main-top"><ThemeToggle /><span>Already registered? <Link className="inline-link" href="/login">Log in</Link></span></div>
        <AuthCard eyebrow="Create your account" title="How will you use CampusBrain?" description="Select your role to continue with the right verification steps.">
          <div className="role-grid">{roles.map(({ title, detail, icon: Icon }) => <Link href={`/signup/${title === "Class representative" ? "cr" : title.toLowerCase()}`} className="role-option" key={title}><span className="role-symbol"><Icon size={19} /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowRight className="role-arrow" size={17} /></Link>)}</div>
          <p className="form-foot">Your university details are verified securely before registration.</p>
        </AuthCard>
      </section>
    </main>
  );
}
