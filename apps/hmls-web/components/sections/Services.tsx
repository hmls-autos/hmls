import { ArrowDownUp, Cpu, Disc, Droplets, Wind, Zap } from "lucide-react";
import Link from "next/link";
import RevealOnScroll from "@/components/ui/RevealOnScroll";

const services = [
  {
    title: "Oil Change",
    description: "Full synthetic oil change with filter and fluid top-off.",
    price: "From $89",
    icon: Droplets,
  },
  {
    title: "Brake Service",
    description: "Pads, rotors, fluid inspection and repair.",
    price: "From $149",
    icon: Disc,
  },
  {
    title: "Battery & Electrical",
    description: "Testing, replacement, and system diagnosis.",
    price: "From $49",
    icon: Zap,
  },
  {
    title: "Engine Diagnostics",
    description: "Check engine light, computer scanning, and troubleshooting.",
    price: "From $79",
    icon: Cpu,
  },
  {
    title: "A/C Service",
    description: "Comprehensive air conditioning inspection and recharge.",
    price: "From $129",
    icon: Wind,
  },
  {
    title: "Suspension",
    description: "Diagnose and repair for a smooth, noise-free ride.",
    price: "From $99",
    icon: ArrowDownUp,
  },
];

export default function Services() {
  return (
    <section id="services" className="w-full py-32 bg-surface-alt">
      <div className="max-w-7xl mx-auto px-6">
        <RevealOnScroll>
          <div className="text-center mb-20">
            <p className="text-sm uppercase tracking-[0.2em] text-red-400 font-display font-semibold mb-4">
              Our Services
            </p>
            <h2 className="text-4xl md:text-5xl font-display font-extrabold text-text tracking-tight mb-6">
              What we can help with
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              From routine maintenance to complex repairs, we handle it all at
              your location.
            </p>
          </div>
        </RevealOnScroll>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service, i) => {
            const Icon = service.icon;
            return (
              <RevealOnScroll key={service.title} delay={Math.min(i + 1, 3)}>
                <div className="group relative bg-surface border border-border rounded-2xl p-8 hover:border-red-500/30 transition-all duration-300 overflow-hidden card-hover">
                  {/* Hover glow */}
                  <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  <div className="relative">
                    <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center mb-6 group-hover:bg-red-500/20 transition-colors duration-300">
                      <Icon
                        className="w-6 h-6 text-red-400"
                        strokeWidth={1.5}
                      />
                    </div>

                    <h3 className="text-lg font-display font-semibold text-text mb-2">
                      {service.title}
                    </h3>
                    <p className="text-text-secondary text-sm leading-relaxed mb-4">
                      {service.description}
                    </p>
                    <p className="text-red-400 font-display font-semibold text-sm">
                      {service.price}
                    </p>
                  </div>
                </div>
              </RevealOnScroll>
            );
          })}
        </div>

        <RevealOnScroll>
          <div className="text-center mt-16 flex flex-wrap justify-center gap-4">
            <Link
              href="/services"
              className="inline-flex items-center gap-2 px-8 py-4 border border-border text-text rounded-xl hover:border-red-500/50 hover:bg-red-500/10 transition-all duration-300 font-display font-semibold tracking-wide"
            >
              View all services
            </Link>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 px-8 py-4 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all duration-300 font-display font-semibold tracking-wide"
            >
              Get an Estimate
            </Link>
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}
