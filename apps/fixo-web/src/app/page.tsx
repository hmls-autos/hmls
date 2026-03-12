"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import {
  Camera,
  Mic,
  Plug,
  MessageSquare,
  Zap,
  FileText,
  ChevronRight,
  Check,
  ArrowRight,
  Send,
  Cpu,
  Wrench,
  Car,
  AlertTriangle,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/* ── Animated diagnostic code rain ── */
function DiagnosticRain() {
  const codes = [
    "P0420",
    "P0171",
    "P0300",
    "P0442",
    "P0128",
    "B1234",
    "C0035",
    "U0100",
    "P0455",
    "P0401",
    "P0116",
    "P0340",
  ];
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden>
      {codes.map((code, i) => (
        <motion.span
          key={code}
          className="absolute text-[11px] font-mono text-primary/[0.07] font-bold"
          style={{
            left: `${8 + (i % 6) * 16}%`,
            top: `${5 + Math.floor(i / 6) * 45}%`,
          }}
          animate={{
            opacity: [0, 0.6, 0],
            y: [0, 30],
          }}
          transition={{
            duration: 4 + (i % 3),
            repeat: Number.POSITIVE_INFINITY,
            delay: i * 0.7,
            ease: "easeInOut",
          }}
        >
          {code}
        </motion.span>
      ))}
    </div>
  );
}

/* ── Animated severity gauge ── */
function SeverityGauge({ level }: { level: number }) {
  const colors = ["bg-emerald-500", "bg-emerald-500", "bg-yellow-500", "bg-amber-500", "bg-red-500"];
  return (
    <div className="flex gap-1 items-end h-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={i}
          className={`w-1.5 rounded-full ${i <= level ? colors[i] : "bg-foreground/10"}`}
          style={{ height: `${40 + i * 15}%` }}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ delay: 0.8 + i * 0.1, duration: 0.3 }}
        />
      ))}
    </div>
  );
}

/* ── Diagnostic Sheet (mechanic inspection report) ── */
const inspectionItems = [
  { system: "Brakes", item: "Front Brake Pads", status: "fail" as const, note: "Worn past minimum — 1mm remaining", cost: "$150 – $300" },
  { system: "Brakes", item: "Rear Brake Pads", status: "warn" as const, note: "~30% life remaining", cost: null },
  { system: "Brakes", item: "Rotors", status: "warn" as const, note: "Light scoring, monitor", cost: null },
  { system: "Engine", item: "Oil Level & Condition", status: "pass" as const, note: null, cost: null },
  { system: "Engine", item: "Coolant System", status: "pass" as const, note: null, cost: null },
  { system: "Suspension", item: "Front Struts", status: "warn" as const, note: "Minor leak detected on driver side", cost: "$400 – $700" },
  { system: "Tires", item: "Tread Depth", status: "pass" as const, note: "6/32\" — good", cost: null },
];

function DiagnosticSheet() {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i <= inspectionItems.length; i++) {
      timers.push(setTimeout(() => setVisibleCount(i + 1), 300 + i * 400));
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  const statusIcon = (s: "pass" | "warn" | "fail") =>
    s === "pass" ? "✓" : s === "warn" ? "!" : "✗";
  const statusColor = (s: "pass" | "warn" | "fail") =>
    s === "pass"
      ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
      : s === "warn"
        ? "text-amber-500 bg-amber-500/10 border-amber-500/20"
        : "text-red-500 bg-red-500/10 border-red-500/20";

  const failCount = inspectionItems.filter((i) => i.status === "fail").length;
  const warnCount = inspectionItems.filter((i) => i.status === "warn").length;
  const passCount = inspectionItems.filter((i) => i.status === "pass").length;

  return (
    <div className="w-full max-w-lg mx-auto">
      <div className="rounded-xl border border-border/80 bg-card shadow-2xl shadow-black/10 overflow-hidden">
        {/* Header — looks like a real inspection form */}
        <div className="px-5 py-4 bg-muted/50 border-b border-border/60">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="size-6 rounded bg-primary flex items-center justify-center">
                <Wrench className="size-3 text-primary-foreground" />
              </div>
              <span className="text-sm font-bold">Fixo<span className="text-primary">.</span> Inspection Report</span>
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">
              #FX-2026-0847
            </span>
          </div>
          <div className="flex gap-4 text-[11px] text-muted-foreground">
            <span>2019 Honda Civic LX</span>
            <span className="text-border">|</span>
            <span>67,420 mi</span>
            <span className="text-border">|</span>
            <span>Mar 8, 2026</span>
          </div>
        </div>

        {/* Inspection items */}
        <div className="divide-y divide-border/40">
          {inspectionItems.map((item, i) => (
            <motion.div
              key={item.item}
              className="px-5 py-2.5 flex items-start gap-3"
              initial={{ opacity: 0 }}
              animate={i < visibleCount ? { opacity: 1 } : {}}
              transition={{ duration: 0.25 }}
            >
              <div
                className={`mt-0.5 size-5 rounded border text-[11px] font-bold flex items-center justify-center shrink-0 ${statusColor(item.status)}`}
              >
                {statusIcon(item.status)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{item.item}</span>
                  {item.cost && (
                    <span className="text-[11px] font-mono text-muted-foreground">{item.cost}</span>
                  )}
                </div>
                {item.note && (
                  <p className="text-[12px] text-muted-foreground mt-0.5">{item.note}</p>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Summary bar */}
        <motion.div
          className="px-5 py-3 bg-muted/30 border-t border-border/60 flex items-center justify-between"
          initial={{ opacity: 0 }}
          animate={visibleCount > inspectionItems.length ? { opacity: 1 } : {}}
          transition={{ duration: 0.4 }}
        >
          <div className="flex gap-3 text-[11px] font-mono">
            <span className="text-red-500">{failCount} FAIL</span>
            <span className="text-amber-500">{warnCount} WARN</span>
            <span className="text-emerald-500">{passCount} PASS</span>
          </div>
          <span className="text-[11px] font-mono text-primary">Est. Total: $550 – $1,000</span>
        </motion.div>
      </div>
    </div>
  );
}

/* ── Input method cards ── */
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

/* ── Real diagnosis examples ── */
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

export default function LandingPage() {
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 border-b border-border/40 bg-background/90 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 h-14">
          <Link href="/" className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-primary flex items-center justify-center">
              <Wrench className="size-3.5 text-primary-foreground" />
            </div>
            <span className="text-base font-bold tracking-tight">Fixo<span className="text-primary">.</span></span>
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/pricing">
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                Pricing
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                Sign In
              </Button>
            </Link>
            <Link href="/login">
              <Button size="sm">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <motion.section ref={heroRef} style={{ opacity: heroOpacity }} className="relative pt-20 pb-24 overflow-hidden">
        <DiagnosticRain />
        <div className="max-w-5xl mx-auto px-6 relative">
          <div className="max-w-2xl mb-14">
            <motion.p
              className="text-sm font-mono text-primary mb-4 tracking-wide"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              AI VEHICLE DIAGNOSTICS
            </motion.p>

            <motion.h1
              className="text-[2.5rem] sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] mb-5"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              Your mechanic charges $150
              <br />
              to tell you this.
            </motion.h1>

            <motion.p
              className="text-lg text-muted-foreground max-w-md mb-8 leading-relaxed"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              Snap a photo, record a sound, or just describe what&apos;s wrong.
              Get a real diagnosis in 30 seconds.
            </motion.p>

            <motion.div
              className="flex gap-3"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <Link href="/login">
                <Button size="lg" className="h-12 px-6 text-[15px]">
                  Try it free
                  <ArrowRight className="size-4" />
                </Button>
              </Link>
              <Link href="#how">
                <Button variant="outline" size="lg" className="h-12 px-6 text-[15px]">
                  How it works
                </Button>
              </Link>
            </motion.div>
            <motion.p
              className="text-xs text-muted-foreground/60 mt-3 font-mono"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
            >
              3 FREE DIAGNOSES/MONTH · NO CREDIT CARD
            </motion.p>
          </div>

          {/* Terminal demo */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <DiagnosticSheet />
          </motion.div>
        </div>
      </motion.section>

      {/* ── Input Methods ── */}
      <section id="how" className="py-20 border-t border-border/40">
        <div className="max-w-5xl mx-auto px-6">
          <motion.div
            className="mb-12"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
          >
            <p className="text-sm font-mono text-primary mb-2 tracking-wide">INPUT</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Four ways to describe the problem.
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {inputMethods.map((method, i) => (
              <motion.div
                key={method.label}
                className={`group relative rounded-xl border border-border/60 bg-card p-5 hover:border-border transition-all cursor-default`}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: i * 0.08 }}
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
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Real Diagnoses ── */}
      <section className="py-20 bg-muted/30 border-y border-border/40">
        <div className="max-w-5xl mx-auto px-6">
          <motion.div
            className="mb-12"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
          >
            <p className="text-sm font-mono text-primary mb-2 tracking-wide">OUTPUT</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
              Not a guess. A diagnosis.
            </h2>
            <p className="text-muted-foreground max-w-lg">
              Severity rating, cost estimate, and what to tell your mechanic — in seconds.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {diagnosisExamples.map((ex, i) => (
              <motion.div
                key={ex.diagnosis}
                className="rounded-xl border border-border/60 bg-card p-5"
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: i * 0.1 }}
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
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Everyone ── */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Car owners */}
            <motion.div
              className="rounded-xl border border-border/60 bg-card p-8"
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
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
            </motion.div>

            {/* Mechanics */}
            <motion.div
              className="rounded-xl border border-border/60 bg-card p-8"
              initial={{ opacity: 0, x: 16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
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
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="py-20 bg-muted/30 border-y border-border/40">
        <div className="max-w-3xl mx-auto px-6">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <p className="text-sm font-mono text-primary mb-2 tracking-wide">PRICING</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
              One shop visit or a year of Plus.
            </h2>
            <p className="text-muted-foreground">You pick.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <motion.div
              className="rounded-xl border border-border/60 bg-card p-7"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h3 className="font-semibold mb-1">Free</h3>
              <div className="mb-5">
                <span className="text-4xl font-bold">$0</span>
              </div>
              <ul className="space-y-2 mb-7">
                {["3 text diagnoses/month", "1 vehicle", "Basic AI analysis"].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="size-3.5 text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href="/login">
                <Button variant="outline" className="w-full">
                  Get Started
                </Button>
              </Link>
            </motion.div>

            <motion.div
              className="rounded-xl border-2 border-primary/30 bg-card p-7 relative"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.08 }}
            >
              <span className="absolute -top-2.5 left-5 text-[11px] font-mono bg-primary text-primary-foreground px-2 py-0.5 rounded">
                RECOMMENDED
              </span>
              <h3 className="font-semibold mb-1">Plus</h3>
              <div className="mb-5">
                <span className="text-4xl font-bold">$19.99</span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <ul className="space-y-2 mb-7">
                {[
                  "Unlimited diagnoses",
                  "Photo, audio & OBD-II",
                  "PDF reports",
                  "Unlimited vehicles",
                  "Full history",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="size-3.5 text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href="/pricing">
                <Button className="w-full">Start Plus</Button>
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
              Your car is talking.
            </h2>
            <p className="text-muted-foreground text-lg mb-8">
              Fixo translates.
            </p>
            <Link href="/login">
              <Button size="lg" className="h-12 px-8 text-[15px]">
                Start your first diagnosis
                <ArrowRight className="size-4" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/40 py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <div className="size-5 rounded bg-primary flex items-center justify-center">
              <Wrench className="size-3 text-primary-foreground" />
            </div>
            Fixo<span className="text-primary">.</span>
          </div>
          <div className="flex gap-6">
            <Link href="/pricing" className="hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link href="/login" className="hover:text-foreground transition-colors">
              Sign In
            </Link>
          </div>
          <p>&copy; {new Date().getFullYear()} Fixo<span className="text-primary">.</span></p>
        </div>
      </footer>
    </div>
  );
}
