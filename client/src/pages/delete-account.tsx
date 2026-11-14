import { Link } from "wouter";
import { ArrowLeft, Bus, CheckCircle2, Mail } from "lucide-react";
import { SUPPORT_EMAIL } from "@/pages/support";

// Q59: public page (no sign-in) on how to delete an account. This is the web
// link given to Google Play; the Account page lands here with ?done=1.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <div className="space-y-3 text-slate-600 leading-relaxed">{children}</div>
    </section>
  );
}

export default function DeleteAccount() {
  const done = new URLSearchParams(window.location.search).get("done") === "1";
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Delete my account")}`;

  return (
    <div className="min-h-screen bg-slate-50 safe-area-page" data-testid="page-delete-account">
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
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Delete your account</h1>
              <p className="text-sm text-blue-100">School Bus Tracker</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10 space-y-10">
        {done && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800"
            data-testid="banner-account-deleted"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Your account has been deleted</p>
              <p className="text-sm">You've been signed out. You don't need to do anything else.</p>
            </div>
          </div>
        )}

        <Section title="In the app">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Sign in to the School Bus Tracker app.</li>
            <li>Open the Menu and tap Account.</li>
            <li>Tap "Delete my account", enter your password and confirm.</li>
          </ol>
          <p>Drivers: go off duty first.</p>
        </Section>

        <Section title="On the web">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Sign in at schoolbustracker.org.</li>
            <li>Open the Menu and choose Account.</li>
            <li>Choose "Delete my account", enter your password and confirm.</li>
          </ol>
        </Section>

        <Section title="Can't sign in?">
          <p>
            Use "Forgot password" on the sign-in screen first, then delete your account as above. Or
            email{" "}
            <a href={mailto} className="text-blue-700 underline" data-testid="link-email-delete">
              {SUPPORT_EMAIL}
            </a>{" "}
            from your account's email address with the subject "Delete my account", and we'll delete it
            for you.
          </p>
        </Section>

        <Section title="What is deleted">
          <ul className="list-disc space-y-2 pl-5">
            <li>Your name, email address, phone number and login.</li>
            <li>Your links to your children.</li>
            <li>You're signed out on all your devices, and notifications for the account stop.</li>
          </ul>
          <p>Deletion happens straight away and can't be undone.</p>
        </Section>

        <Section title="What the school keeps">
          <p>
            Your school or camp keeps its own records, such as trips, attendance and messages. In
            those records your name is replaced with "Deleted user". If you sign up again later, the
            new account starts empty.
          </p>
        </Section>

        <Section title="Staff accounts">
          <p>
            Administrator and staff accounts are removed by your school's administrator. To close a
            school's account, email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-700 underline" data-testid="link-email-support">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <div className="border-t border-slate-200 pt-6 space-y-2 text-sm text-slate-500">
          <p>
            See also our{" "}
            <Link href="/privacy" className="text-blue-700 underline" data-testid="link-privacy">
              Privacy Policy
            </Link>
            {" "}and{" "}
            <Link href="/support" className="text-blue-700 underline" data-testid="link-support">
              Support
            </Link>
            .
          </p>
          <p className="inline-flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {SUPPORT_EMAIL}
          </p>
        </div>
      </main>
    </div>
  );
}
