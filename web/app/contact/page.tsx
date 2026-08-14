export default function ContactPage() {
  return (
    <div>
      <h1>Contact</h1>
      <p className="subtitle">Questions, feedback, or interested in using Summit TPE for your program?</p>

      <div className="card card-prose">
        <h2>Get in touch</h2>
        <p style={{ marginBottom: 4 }}>
          <a href="mailto:womens@estrellaworks.com">womens@estrellaworks.com</a>
        </p>
        <p className="section-note" style={{ marginTop: 12, marginBottom: 0 }}>
          Bug reports, a stat that looks off, a feature you wish existed, or interest in bringing this to your
          program&apos;s own transfer evaluation -- all of it is useful, and every message reaches a real
          person. Include a team or player name if you&apos;re flagging a specific number so it&apos;s easy to
          track down.
        </p>
        {/* PLACEHOLDER -- add a phone number, X/LinkedIn, or a real contact form (needs a form backend
            or an email service like Formspree/Resend -- this static page has no server-side mail sending
            wired up yet) once there's a preference for how coaches should actually reach out. */}
      </div>
    </div>
  );
}
