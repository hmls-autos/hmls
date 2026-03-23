import { Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { FadeIn } from "@/components/ui/Animations";
import LazyMap from "@/components/ui/LazyMap";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch for reliable auto care. We come to you anywhere in Orange County. Call (949) 213-7073.",
};

export default function Contact() {
  return (
    <main className="flex-1 flex flex-col items-center bg-background text-text">
      <section className="w-full max-w-3xl px-6 pt-12 pb-12 flex-1">
        <div className="flex flex-col items-center text-center">
          <FadeIn direction="up">
            <div className="inline-block mb-4 px-4 py-1.5 rounded-full border border-red-primary/30 bg-red-light text-red-primary text-xs tracking-widest uppercase font-display font-semibold">
              Contact Us
            </div>
            <h1 className="text-5xl md:text-6xl font-display font-bold mb-8 leading-tight">
              Get in Touch for{" "}
              <span className="text-red-primary">Reliable Auto Care.</span>
            </h1>
            <p className="text-xl text-text-secondary font-light mb-12 max-w-lg mx-auto">
              Ready to schedule a service or have a question? We&apos;re here to
              help. We come to you anywhere in Orange County.
            </p>

            <div className="flex flex-col sm:flex-row justify-center gap-8 mb-12">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-light flex items-center justify-center text-red-primary">
                  <MapPin className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs text-text-secondary">
                    Service Area
                  </div>
                  <div className="text-sm font-medium">Orange County, CA</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-light flex items-center justify-center text-red-primary">
                  <Phone className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs text-text-secondary">Phone</div>
                  <a
                    href="tel:+19492137073"
                    className="text-sm font-medium hover:text-red-primary transition-colors"
                  >
                    (949) 213-7073
                  </a>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-light flex items-center justify-center text-red-primary">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs text-text-secondary">Email</div>
                  <a
                    href="mailto:business@hmls.autos"
                    className="text-sm font-medium hover:text-red-primary transition-colors"
                  >
                    business@hmls.autos
                  </a>
                </div>
              </div>
            </div>

            <div className="w-full h-80 rounded-2xl overflow-hidden border border-border relative group">
              <LazyMap className="w-full h-full" />
            </div>
          </FadeIn>
        </div>
      </section>
    </main>
  );
}
