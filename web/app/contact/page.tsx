export default function ContactPage() {
  return (
    <div>
      <h1>Contact</h1>
      <p className="subtitle">Questions, feedback, or interested in using Summit TPE for your program?</p>

      <div className="card" style={{ maxWidth: 480 }}>
        <h2>Get in touch</h2>
        <p style={{ marginBottom: 4 }}>
          <strong>Keeshaun Cobb</strong>
        </p>
        <p style={{ marginBottom: 4 }}>
          <a href="mailto:keeshaun@estrellaworks.com">keeshaun@estrellaworks.com</a>
        </p>
        {/* PLACEHOLDER -- add a phone number, X/LinkedIn, or a real contact form (needs a form backend
            or an email service like Formspree/Resend -- this static page has no server-side mail sending
            wired up yet) once there's a preference for how coaches should actually reach out. */}
      </div>
    </div>
  );
}
