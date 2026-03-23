import type { Metadata } from "next";
import { FadeIn } from "@/components/ui/Animations";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for HMLS Mobile Mechanic.",
};

export default function Privacy() {
  return (
    <main className="flex flex-col items-center bg-background text-text overflow-x-hidden">
      <section className="w-full max-w-4xl px-6 pt-16 pb-20">
        <FadeIn className="mb-12">
          <div className="inline-block mb-4 px-4 py-1.5 rounded-full border border-red-primary/30 bg-red-light text-red-primary text-xs tracking-widest uppercase font-display font-semibold">
            Legal
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
            Privacy Policy
          </h1>
          <p className="text-text-secondary text-sm">
            Last updated: {new Date().toLocaleDateString()}
          </p>
        </FadeIn>

        <FadeIn delay={0.1} className="space-y-8">
          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Information We Collect
            </h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              When you use HMLS Mobile Mechanic services, we may collect the
              following information:
            </p>
            <ul className="text-text-secondary leading-relaxed space-y-2 list-disc list-inside">
              <li>Contact information (name, phone number, email address)</li>
              <li>Vehicle information (make, model, year, VIN)</li>
              <li>Service location and address</li>
              <li>Service history and preferences</li>
              <li>Payment information (processed securely via Stripe)</li>
            </ul>
          </div>

          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              How We Use Your Information
            </h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              We use your information to:
            </p>
            <ul className="text-text-secondary leading-relaxed space-y-2 list-disc list-inside">
              <li>Schedule and provide mobile mechanic services</li>
              <li>Process payments and send invoices</li>
              <li>Communicate about appointments and services</li>
              <li>Improve our services and customer experience</li>
              <li>Send service reminders and updates (with your consent)</li>
            </ul>
          </div>

          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Data Security
            </h2>
            <p className="text-text-secondary leading-relaxed">
              We take the security of your personal information seriously. All
              payment information is processed securely through Stripe and is
              never stored on our servers. We use industry-standard security
              measures to protect your data from unauthorized access,
              disclosure, or misuse.
            </p>
          </div>

          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Your Rights
            </h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              You have the right to:
            </p>
            <ul className="text-text-secondary leading-relaxed space-y-2 list-disc list-inside">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your information</li>
              <li>Opt out of marketing communications</li>
            </ul>
          </div>

          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Contact Us
            </h2>
            <p className="text-text-secondary leading-relaxed">
              If you have any questions about this Privacy Policy, please
              contact us at{" "}
              <a
                href="mailto:privacy@hmls.autos"
                className="text-red-primary hover:text-red-dark transition-colors"
              >
                privacy@hmls.autos
              </a>
              .
            </p>
          </div>
        </FadeIn>
      </section>
    </main>
  );
}
