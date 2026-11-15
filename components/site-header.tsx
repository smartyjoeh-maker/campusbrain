import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Brand />
      <nav className="header-actions" aria-label="Main navigation">
        <Link href="/login" className="header-login">Log in</Link>
        <ThemeToggle />
        <Link href="/signup" className="button button-small">Get started <span aria-hidden>↗</span></Link>
      </nav>
    </header>
  );
}
