import { Link } from "wouter";
import { ArrowLeft, Bus } from "lucide-react";

const LAST_UPDATED = "July 11, 2026";
const CONTACT_EMAIL = "deshaun@tntgym.org";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <div className="space-y-3 text-slate-600 leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-slate-50" data-testid="page-privacy">
      <header className="bg-blue-700 text-white">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-blue-100 hover:text-white transition-colors"
            data-testid="link-back-home"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to School Bus Tracker
          </Link>
          <div className="mt-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
              <Bus className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Privacy Policy</h1>
              <p className="text-sm text-blue-100">School Bus Tracker</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-slate-500" data-testid="text-last-updated">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-10">
          <p className="text-slate-600 leading-relaxed">
            School Bus Tracker ("the App," "we," "us"), operated by Holden Enterprise LLC, helps
            schools, camps, and similar organizations track their buses in real time. Administrators
            manage routes, students, and drivers; drivers share their location while on duty; and
            parents see when a bus is approaching. This policy explains what information the App
            handles, how it is used, and the choices you have.
          </p>

          <Section title="Who controls your information">
            <p>
              School Bus Tracker is a multi-tenant service. When your school, camp, or organization
              uses the App, that organization controls the student, route, and roster information it
              enters and decides who may access it. We process that information on the organization's
              behalf. If you are a parent or driver, direct questions about your data to your
              organization first; you may also contact us using the details below.
            </p>
          </Section>

          <Section title="Information we collect">
            <p><strong>Account information.</strong> Name, email address, phone number, role
              (parent, driver, admin), and a securely hashed password. We never store passwords in
              plain text.</p>
            <p><strong>Student and route information.</strong> Entered by an organization's
              administrators: student names, assigned schools, routes, stops, and parent-child links.
              This information is created by authorized adults, not collected directly from children.</p>
            <p><strong>Location information.</strong> When a driver turns duty on, the App collects
              the driver's device location so that authorized parents and administrators in the same
              organization can see the bus's position and estimated arrival. Location is not collected
              when the driver is off duty.</p>
            <p><strong>Notification tokens.</strong> A device push token so we can send bus-approach
              and status notifications. Tokens are deactivated when you log out.</p>
            <p><strong>Billing information.</strong> For organizations that subscribe, our payment
              processor (Stripe) handles card details. We receive only subscription status and plan
              information — we do not store full card numbers.</p>
            <p><strong>Technical information.</strong> Basic information needed to operate the service,
              such as session data and error logs.</p>
          </Section>

          <Section title="How we use information">
            <ul className="list-disc space-y-2 pl-5">
              <li>Provide the core service: real-time bus tracking, routes, rosters, and check-ins.</li>
              <li>Send notifications you or your organization have enabled (for example, bus approaching).</li>
              <li>Authenticate users and keep accounts secure.</li>
              <li>Process subscriptions and manage plan limits for organizations.</li>
              <li>Diagnose problems and improve reliability.</li>
            </ul>
            <p>We do not sell personal information, and we do not use it for advertising.</p>
          </Section>

          <Section title="How location information is shared">
            <p>
              A driver's live location is visible only to administrators and to parents of students
              on that driver's route, within the same organization. It is used to show the bus's
              position and approach, and it is not shared with anyone outside your organization except
              the service providers needed to deliver the App (below).
            </p>
          </Section>

          <Section title="Service providers">
            <p>
              We share information with trusted providers only as needed to run the App: our payment
              processor (Stripe) for subscriptions, push-notification services operated by Apple and
              Google for delivering notifications, and cloud hosting and database providers that store
              the App's data. These providers are permitted to use the information only to perform
              services for us.
            </p>
          </Section>

          <Section title="Children's privacy">
            <p>
              School Bus Tracker is designed for use by adults — school and camp staff, drivers, and
              parents — to manage student transportation. It is not directed to children, and children
              do not create accounts or provide information directly through the App. Student
              information is entered and controlled by an organization's authorized administrators. If
              you believe a child has provided us information directly, contact us and we will remove it.
            </p>
          </Section>

          <Section title="Data retention">
            <p>
              We keep account and organization information for as long as the account is active and as
              needed to provide the service. Location data is retained only as needed to support live
              tracking and recent trip history. When an organization or user asks us to delete
              information, we remove it except where we must keep records to meet legal or billing
              obligations.
            </p>
          </Section>

          <Section title="Security">
            <p>
              Data is encrypted in transit using HTTPS, passwords are stored using industry-standard
              hashing, and access to organization data is restricted to authorized users within that
              organization. No system is perfectly secure, but we work to protect your information.
            </p>
          </Section>

          <Section title="Your choices and rights">
            <ul className="list-disc space-y-2 pl-5">
              <li>Access or correct your account information from within the App, or by contacting us.</li>
              <li>Turn location off by ending duty (drivers) or disabling location in device settings.</li>
              <li>Turn off notifications in your device settings; logging out deactivates your device token.</li>
              <li>Request deletion of your account or information by contacting us at the address below.</li>
            </ul>
          </Section>

          <Section title="Changes to this policy">
            <p>
              We may update this policy from time to time. When we do, we will revise the "Last
              updated" date above and, where appropriate, notify organizations of significant changes.
            </p>
          </Section>

          <Section title="Contact us">
            <p>
              Questions about this policy or your information? Email us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-700 underline" data-testid="link-contact-email">
                {CONTACT_EMAIL}
              </a>.
            </p>
          </Section>
        </div>

        <div className="mt-12 border-t border-slate-200 pt-6">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-blue-700 hover:text-blue-900" data-testid="link-back-home-footer">
            <ArrowLeft className="h-4 w-4" />
            Back to School Bus Tracker
          </Link>
        </div>
      </main>
    </div>
  );
}
