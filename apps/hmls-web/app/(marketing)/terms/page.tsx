import type { Metadata } from "next";
import { FadeIn } from "@/components/ui/Animations";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of service for HMLS Mobile Mechanic.",
};

export default function Terms() {
  return (
    <main className="flex flex-col items-center bg-background text-text overflow-x-hidden">
      <section className="w-full max-w-4xl px-6 pt-16 pb-20">
        <FadeIn className="mb-12">
          <div className="inline-block mb-4 px-4 py-1.5 rounded-full border border-red-primary/30 bg-red-light text-red-primary text-xs tracking-widest uppercase font-display font-semibold">
            Legal
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
            Terms of Service
          </h1>
          <p className="text-text-secondary text-sm">
            Last updated: {new Date().toLocaleDateString()}
          </p>
        </FadeIn>

        <FadeIn delay={0.1} className="space-y-8">
          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Agreement to Terms
            </h2>
            <p className="text-text-secondary leading-relaxed">
              By accessing or using HMLS Mobile Mechanic services, you agree to
              be bound by these Terms of Service. If you do not agree to these
              terms, please do not use our services.
            </p>
          </div>

          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Services
            </h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              HMLS Mobile Mechanic provides mobile automotive repair and
              maintenance services in Orange County, California. Our services
              include but are not limited to:
            </p>
            <ul className="text-text-secondary leading-relaxed space-y-2 list-disc list-inside">
              <li>Oil changes and fluid services</li>
              <li>Brake repairs and replacements</li>
              <li>Battery testing and replacement</li>
              <li>Diagnostic services</li>
              <li>General maintenance and repairs</li>
            </ul>
          </div>

          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Scheduling and Cancellation
            </h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              Appointments can be scheduled through our website, chat assistant,
              or by phone. We request at least 24 hours notice for
              cancellations.
            </p>
            <p className="text-text-secondary leading-relaxed">
              We reserve the right to reschedule appointments due to weather
              conditions, emergencies, or other unforeseen circumstances. We
              will notify you as soon as possible if rescheduling is necessary.
            </p>
          </div>

          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Payment Terms
            </h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              Payment is due upon completion of services unless otherwise
              agreed. We accept major credit cards, debit cards, and other
              payment methods as indicated during checkout.
            </p>
            <p className="text-text-secondary leading-relaxed">
              Quotes provided are estimates based on the information provided.
              Final pricing may vary based on actual conditions discovered
              during service. Any additional work will be discussed and approved
              before proceeding.
            </p>
          </div>

          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Warranty
            </h2>
            <p className="text-text-secondary leading-relaxed">
              We stand behind our work. Parts and labor are warranted for a
              period specified at the time of service. Warranty terms vary by
              service type and will be clearly communicated in your service
              invoice.
            </p>
          </div>

          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Limitation of Liability
            </h2>
            <p className="text-text-secondary leading-relaxed">
              HMLS Mobile Mechanic shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages arising
              from the use of our services. Our total liability shall not exceed
              the amount paid for the specific service in question.
            </p>
          </div>

          <div className="p-8 rounded-2xl border border-border bg-surface">
            <h2 className="text-xl font-display font-semibold mb-4 text-red-primary">
              Contact Us
            </h2>
            <p className="text-text-secondary leading-relaxed">
              If you have any questions about these Terms of Service, please
              contact us at{" "}
              <a
                href="mailto:legal@hmls.autos"
                className="text-red-primary hover:text-red-dark transition-colors"
              >
                legal@hmls.autos
              </a>
              .
            </p>
          </div>
        </FadeIn>
      </section>
    </main>
  );
}
