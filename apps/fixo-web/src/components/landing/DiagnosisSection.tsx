import { AlertTriangle, Wrench, Car } from "lucide-react";
import { AnimateInView } from "@/components/ui/animate-in-view";

/* ── Animated severity gauge ── */
function SeverityGauge({ level }: { level: number }) {
  const colors = ["bg-emerald-500", "bg-emerald-500", "bg-yellow-500", "bg-amber-500", "bg-red-500"];
  return (
    <div className="flex gap-1 items-end h-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full origin-bottom ${i <= level ? colors[i] : "bg-foreground/10"}`}
          style={{
            height: `${40 + i * 15}%`,
            animation: `gauge-grow 0.3s ease-out ${0.8 + i * 0.1}s both`,
          }}
        />
      ))}
    </div>
  );
}

const diagnosisExamples = [
  {
    symptom: "Engine light on, rough idle",
    code: "P0300",
    diagnosis: "Random/Multiple Cylinder Misfire",
    severity: 3,
    cost: "$200 – $600",
    icon: AlertTriangle,
  },
  {
    symptom: "Squealing when turning",
    code: null,
    diagnosis: "Worn Serpentine Belt",
    severity: 1,
    cost: "$75 – $200",
    icon: Wrench,
  },
  {
    symptom: "Car pulls to one side",
    code: null,
    diagnosis: "Wheel Alignment / Tie Rod Wear",
    severity: 2,
    cost: "$100 – $350",
    icon: Car,
  },
];

export function DiagnosisSection() {
  return (
    <section className="py-20 bg-muted/30 border-y border-border/40">
      <div className="max-w-5xl mx-auto px-6">
        <AnimateInView className="mb-12" margin="-80px">
          <p className="text-sm font-mono text-primary mb-2 tracking-wide">OUTPUT</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
            Not a guess. A diagnosis.
          </h2>
          <p className="text-muted-foreground max-w-lg">
            Severity rating, cost estimate, and what to tell your mechanic — in seconds.
          </p>
        </AnimateInView>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {diagnosisExamples.map((ex, i) => (
            <AnimateInView
              key={ex.diagnosis}
              className="rounded-xl border border-border/60 bg-card p-5"
              delay={i * 100}
            >
              <div className="flex items-center justify-between mb-3">
                <ex.icon className="size-5 text-muted-foreground" />
                {ex.code && (
                  <span className="text-[11px] font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
                    {ex.code}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-2 italic">
                &ldquo;{ex.symptom}&rdquo;
              </p>
              <h3 className="font-semibold text-sm mb-3">{ex.diagnosis}</h3>
              <div className="flex items-center justify-between">
                <SeverityGauge level={ex.severity} />
                <span className="text-xs font-mono text-muted-foreground">
                  {ex.cost}
                </span>
              </div>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  );
}
