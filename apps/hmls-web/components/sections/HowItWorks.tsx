import { CalendarDays, MapPin, ThumbsUp } from "lucide-react";
import RevealOnScroll from "@/components/ui/RevealOnScroll";

const steps = [
  {
    number: "01",
    title: "Book online",
    description:
      "Get a quote in minutes through our AI assistant. Pick your service, date, and location.",
    icon: CalendarDays,
  },
  {
    number: "02",
    title: "We come to you",
    description:
      "Our certified mechanic arrives at your home or office with everything needed.",
    icon: MapPin,
  },
  {
    number: "03",
    title: "Done",
    description: "Pay when you're satisfied. No hidden fees, no surprises.",
    icon: ThumbsUp,
  },
];

export default function HowItWorks() {
  return (
    <section className="w-full py-32 bg-background">
      <div className="max-w-7xl mx-auto px-6">
        <RevealOnScroll>
          <h2 className="text-4xl md:text-5xl font-display font-extrabold text-text text-center mb-20 tracking-tight">
            How it works
          </h2>
        </RevealOnScroll>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <RevealOnScroll key={step.number} delay={i + 1}>
                <div className="relative group text-center">
                  <div className="relative mx-auto w-20 h-20 rounded-full bg-surface border border-border flex items-center justify-center mb-8 group-hover:border-red-500/50 group-hover:shadow-lg group-hover:shadow-red-500/10 transition-all duration-300">
                    <Icon className="w-8 h-8 text-red-400" strokeWidth={1.5} />
                    <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-red-600 flex items-center justify-center text-xs font-display font-semibold text-white shadow-lg shadow-red-600/30">
                      {step.number}
                    </div>
                  </div>

                  <h3 className="text-xl md:text-2xl font-display font-semibold tracking-tight text-text mb-3">
                    {step.title}
                  </h3>
                  <p className="text-text-secondary leading-relaxed max-w-xs mx-auto">
                    {step.description}
                  </p>
                </div>
              </RevealOnScroll>
            );
          })}
        </div>
      </div>
    </section>
  );
}
