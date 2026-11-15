import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { RegistrationForm } from "@/components/registration-form";

export default async function SignupRolePage({ params }: { params: Promise<{ role: string }> }) {
  const { role: rawRole } = await params;
  if (!["student", "cr", "lecturer"].includes(rawRole)) return <main className="auth-shell"><section className="auth-main"><AuthCard eyebrow="Registration" title="Choose a valid role" description="Select student, class representative, or lecturer registration."><Link href="/signup">Back to registration</Link></AuthCard></section></main>;
  const role = rawRole === "cr" ? "Class representative" : rawRole.charAt(0).toUpperCase() + rawRole.slice(1);
  const kind = rawRole as "student" | "cr" | "lecturer";
  return (
    <main className="auth-shell">
      <aside className="auth-aside"><Brand light /><div className="aside-message"><p className="eyebrow">Verified registration</p><h2>A trusted campus account, made for you.</h2><p>We’ll match your details against records provided by your institution.</p></div><div className="aside-foot">Your information stays protected</div></aside>
      <section className="auth-main"><div className="auth-main-top"><ThemeToggle /><Link className="inline-link" href="/signup">Change role</Link></div>
        <AuthCard eyebrow="Registration" title={`Join as ${role}`} description="Your details are checked privately against records imported by your institution.">
          <RegistrationForm kind={kind} />
          <p className="form-foot"><Link href="/signup" className="inline-link">← Back to role selection</Link></p>
        </AuthCard>
      </section>
    </main>
  );
}
