import Link from "next/link";
import { ArrowUpRight, BellRing, CalendarDays, MapPin, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A clearer campus day</p>
          <h1>Your campus,<br />in <em>sync.</em></h1>
          <p className="hero-description">One thoughtful space for classroom coordination and the updates that keep your university moving.</p>
          <div className="hero-cta">
            <Link className="button" href="/signup">Join your campus <ArrowUpRight size={16} /></Link>
            <Link className="text-link" href="/login">I have an account <span>→</span></Link>
          </div>
          <div className="trust-note"><span className="trust-dot" />Built for the people who make campus work</div>
        </div>
        <div className="hero-art" aria-label="Illustration of a coordinated campus schedule">
          <div className="art-orb" /><div className="art-ring" />
          <div className="floating-note note-one"><span className="note-icon"><BellRing size={16} /></span><span><strong>Lecture update</strong>Decision shared with students</span></div>
          <div className="dashboard-card">
            <div className="dash-top"><strong>Today on campus</strong><span>•••</span></div>
            <div className="dash-date"><span><small>YOUR SCHEDULE</small><br /><strong>Coming up</strong></span><CalendarDays color="var(--green)" size={21} /></div>
            <div className="schedule">
              <div className="schedule-row"><span className="schedule-time">09:00<br />10:00</span><span className="schedule-info"><strong>Lecture session</strong><small>Course details appear here</small></span><span className="schedule-status">SCHEDULED</span></div>
              <div className="schedule-row"><span className="schedule-time">11:00<br />12:00</span><span className="schedule-info"><strong>Classroom coordination</strong><small>Booking information</small></span><span className="schedule-status">UPDATED</span></div>
              <div className="schedule-row"><span className="schedule-time">14:00<br />15:00</span><span className="schedule-info"><strong>Campus activity</strong><small>Your programme schedule</small></span><span className="schedule-status">UP NEXT</span></div>
            </div>
          </div>
          <div className="floating-note note-two"><span className="note-icon"><MapPin size={16} /></span><span><strong>Rooms in one view</strong>Find the right space</span></div>
        </div>
      </section>
      <section className="feature-strip" aria-label="CampusBrain features">
        <div className="feature"><CalendarDays size={17} />Schedules that stay in sync</div>
        <div className="feature"><BellRing size={17} />Timely lecture updates</div>
        <div className="feature"><ShieldCheck size={17} />Verified campus access</div>
      </section>
    </main>
  );
}
