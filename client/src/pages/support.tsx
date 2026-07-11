import { Link } from "wouter";
import { ArrowLeft, Bus, Mail } from "lucide-react";

const SUPPORT_EMAIL = "support@schoolbustracker.org";

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-slate-900">{q}</h3>
      <div className="text-slate-600 leading-relaxed">{children}</div>
    </div>
  );
}

export default function Support() {
  return (
    <div className="min-h-screen bg-slate-50" data-testid="page-support">
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
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Support</h1>
              <p className="text-sm text-blue-100">School Bus Tracker</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10 space-y-10">
        <section className="space-y-4">
          <p className="text-slate-600 leading-relaxed">
            Need a hand with School Bus Tracker? We're happy to help. Email us and we'll get back to
            you as soon as we can — usually within one to two business days.
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-3 font-medium text-white hover:bg-blue-800 transition-colors"
            data-testid="link-email-support"
          >
            <Mail className="h-5 w-5" />
            {SUPPORT_EMAIL}
          </a>
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-slate-900">Common questions</h2>

          <Faq q="I'm a parent — how do I see my child's bus?">
            Your school or camp administrator gives you a link code (for example, TNT-483921). Create
            an account or sign in, then redeem the code to connect to your child. Once linked, you'll
            see their route and get notified when the bus is approaching.
          </Faq>

          <Faq q="I'm a driver and didn't get a login.">
            Driver accounts are created by your organization's administrator, who sends a setup link to
            finish your account. If you didn't receive one, contact your administrator first — or email
            us and we'll help.
          </Faq>

          <Faq q="I forgot my password.">
            Use "Forgot password" on the sign-in screen to reset it by email. If you're still stuck,
            reach out and we'll get you back in.
          </Faq>

          <Faq q="The bus location isn't updating.">
            Parents can see a bus only while its driver is on duty. Drivers: make sure duty is turned
            on and that the app has permission to use your location in your device settings.
          </Faq>

          <Faq q="I'm an administrator with a billing or account question.">
            Email us at the address above with your organization name and we'll sort it out — plans,
            user limits, or anything else about your account.
          </Faq>
        </section>

        <div className="border-t border-slate-200 pt-6 space-y-2 text-sm text-slate-500">
          <p>
            See also our{" "}
            <Link href="/privacy" className="text-blue-700 underline" data-testid="link-privacy">
              Privacy Policy
            </Link>.
          </p>
          <Link href="/" className="inline-flex items-center gap-2 text-blue-700 hover:text-blue-900" data-testid="link-back-home-footer">
            <ArrowLeft className="h-4 w-4" />
            Back to School Bus Tracker
          </Link>
        </div>
      </main>
    </div>
  );
}
