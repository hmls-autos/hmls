import { Camera, Mic, Plug, MessageSquare } from "lucide-react";
import { AnimateInView } from "@/components/ui/animate-in-view";

const inputMethods = [
  {
    icon: Camera,
    label: "Photo",
    example: "\"What's this puddle under my car?\"",
    color: "group-hover:text-blue-400",
    bg: "group-hover:bg-blue-500/10",
  },
  {
    icon: Mic,
    label: "Audio",
    example: "\"It clicks when I turn right\"",
    color: "group-hover:text-violet-400",
    bg: "group-hover:bg-violet-500/10",
  },
  {
    icon: Plug,
    label: "OBD-II",
    example: "P0420 — Catalyst efficiency below threshold",
    color: "group-hover:text-amber-400",
    bg: "group-hover:bg-amber-500/10",
  },
  {
    icon: MessageSquare,
    label: "Text",
    example: "\"Shakes over 60mph, worse after rain\"",
    color: "group-hover:text-emerald-400",
    bg: "group-hover:bg-emerald-500/10",
  },
];

export function InputMethodsSection() {
  return (
    <section id="how" className="py-20 border-t border-border/40">
      <div className="max-w-5xl mx-auto px-6">
        <AnimateInView className="mb-12" margin="-80px">
          <p className="text-sm font-mono text-primary mb-2 tracking-wide">INPUT</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Four ways to describe the problem.
          </h2>
        </AnimateInView>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {inputMethods.map((method, i) => (
            <AnimateInView
              key={method.label}
              className={`group relative rounded-xl border border-border/60 bg-card p-5 hover:border-border transition-all cursor-default`}
              delay={i * 80}
            >
              <div className="flex items-start gap-4">
                <div className={`size-10 rounded-lg bg-muted flex items-center justify-center transition-colors ${method.bg}`}>
                  <method.icon className={`size-5 text-muted-foreground transition-colors ${method.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm mb-1">{method.label}</h3>
                  <p className="text-sm text-muted-foreground italic truncate">
                    {method.example}
                  </p>
                </div>
              </div>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  );
}
