import { Car, Wrench, Check } from "lucide-react";
import { AnimateInView } from "@/components/ui/animate-in-view";

export function AudienceSection() {
  return (
    <section className="py-20">
      <div className="max-w-5xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Car owners */}
          <AnimateInView
            className="rounded-xl border border-border/60 bg-card p-8"
            animation="animate-in fade-in slide-in-from-left-4 duration-400 fill-mode-both"
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Car className="size-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold">Car Owners</h3>
                <p className="text-xs text-muted-foreground">Stop overpaying for answers</p>
              </div>
            </div>
            <ul className="space-y-2.5">
              {[
                "Know what's wrong before the shop tells you",
                "Check if a repair quote is fair",
                "Track your vehicle's issue history",
                "Share a professional PDF with any mechanic",
              ].map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm">
                  <Check className="size-3.5 text-primary mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{p}</span>
                </li>
              ))}
            </ul>
          </AnimateInView>

          {/* Mechanics */}
          <AnimateInView
            className="rounded-xl border border-border/60 bg-card p-8"
            animation="animate-in fade-in slide-in-from-right-4 duration-400 fill-mode-both"
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Wrench className="size-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold">Mechanics & Shops</h3>
                <p className="text-xs text-muted-foreground">A second opinion that&apos;s instant</p>
              </div>
            </div>
            <ul className="space-y-2.5">
              {[
                "Speed up intake with AI pre-diagnosis",
                "Cross-reference tricky DTCs in seconds",
                "Generate customer-facing reports",
                "Handle more cars with the same team",
              ].map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm">
                  <Check className="size-3.5 text-primary mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{p}</span>
                </li>
              ))}
            </ul>
          </AnimateInView>
        </div>
      </div>
    </section>
  );
}
