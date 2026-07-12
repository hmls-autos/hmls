import { CheckCircle2, Clock, DollarSign, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { FadeIn } from "@/components/ui/Animations";
import { BUSINESS } from "@/lib/business";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { CITIES, findService, SERVICES } from "@/lib/seo-content";

interface Props {
  params: Promise<{ service: string }>;
}

export function generateStaticParams() {
  return SERVICES.map((s) => ({ service: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { service: slug } = await params;
  const service = findService(slug);
  if (!service) return { title: "Not Found" };
  const title = `${service.name} — Mobile in Orange County & San Jose`;
  const description = `${service.shortName} done at your home or office in Orange County and the San Jose / South Bay. ${service.estimatedRange}. Typical visit: ${service.typicalDuration}. Call ${BUSINESS.phoneDisplay}.`;
  return {
    title,
    description,
    alternates: { canonical: `${BUSINESS.url}/services/${service.slug}` },
    openGraph: { title, description, type: "website" },
  };
}

export default async function ServicePage({ params }: Props) {
  const { service: slug } = await params;
  const service = findService(slug);
  if (!service) notFound();

  const otherServices = SERVICES.filter((s) => s.slug !== service.slug);

  return (
    <main className="flex-1 flex flex-col items-center bg-background text-text">
      <JsonLd data={serviceSchema(service)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", url: BUSINESS.url },
          { name: "Services", url: `${BUSINESS.url}/services` },
          {
            name: service.shortName,
            url: `${BUSINESS.url}/services/${service.slug}`,
          },
        ])}
      />

      <section className="w-full max-w-4xl px-6 pt-16 pb-12">
        <FadeIn direction="up">
          <div className="inline-block mb-4 px-4 py-1.5 rounded-full border border-red-primary/30 bg-red-light text-red-primary text-xs tracking-widest uppercase font-display font-semibold">
            Mobile Service
          </div>
          <h1 className="text-5xl md:text-6xl font-display font-semibold mb-4 leading-tight">
            {service.name}
          </h1>
          <p className="text-xl text-text-secondary font-light mb-8 max-w-2xl leading-relaxed">
            {service.intro}
          </p>

          <div className="flex flex-wrap gap-6 mb-10 text-sm">
            <div className="flex items-center gap-2 text-text-secondary">
              <Clock className="w-4 h-4 text-red-primary" />
              <span>{service.typicalDuration}</span>
            </div>
            <div className="flex items-center gap-2 text-text-secondary">
              <DollarSign className="w-4 h-4 text-red-primary" />
              <span>{service.estimatedRange}</span>
            </div>
            <a
              href={`tel:${BUSINESS.phone}`}
              className="flex items-center gap-2 text-red-primary hover:underline"
            >
              <Phone className="w-4 h-4" />
              <span>{BUSINESS.phoneDisplay}</span>
            </a>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mb-12">
            <Link
              href="/chat"
              className="inline-flex items-center justify-center px-8 py-4 rounded-xl bg-red-primary text-white font-semibold hover:bg-red-primary/90 transition-colors"
            >
              Get an Estimate Now
            </Link>
            <a
              href={`tel:${BUSINESS.phone}`}
              className="inline-flex items-center justify-center px-8 py-4 rounded-xl border border-border bg-surface text-text font-semibold hover:bg-surface-alt transition-colors"
            >
              Call {BUSINESS.phoneDisplay}
            </a>
          </div>
        </FadeIn>

        <FadeIn direction="up" delay={0.1}>
          <h2 className="text-2xl font-display font-semibold tracking-tight mb-4">
            What we do on a {service.shortName.toLowerCase()}
          </h2>
          <ul className="space-y-3 mb-12">
            {service.whatWeDo.map((step) => (
              <li key={step} className="flex gap-3 items-start">
                <CheckCircle2 className="w-5 h-5 text-red-primary mt-0.5 shrink-0" />
                <span className="text-text leading-relaxed">{step}</span>
              </li>
            ))}
          </ul>
        </FadeIn>

        <FadeIn direction="up" delay={0.15}>
          <h2 className="text-2xl font-display font-semibold tracking-tight mb-4">
            Signs you need this service
          </h2>
          <ul className="space-y-3 mb-12">
            {service.signsYouNeedIt.map((sign) => (
              <li key={sign} className="flex gap-3 items-start">
                <span className="text-red-primary mt-1.5">•</span>
                <span className="text-text leading-relaxed">{sign}</span>
              </li>
            ))}
          </ul>
        </FadeIn>

        <FadeIn direction="up" delay={0.2}>
          <h2 className="text-2xl font-display font-semibold tracking-tight mb-4">
            Where we offer {service.shortName.toLowerCase()}
          </h2>
          <p className="text-text-secondary mb-4">
            Across all {CITIES.length} of our Orange County &amp; San Jose
            service areas — most visits happen the same day or the next morning.
          </p>
          <div className="flex flex-wrap gap-2 mb-12">
            {CITIES.map((c) => (
              <Link
                key={c.slug}
                href={`/areas/${c.slug}`}
                className="px-4 py-2 rounded-full bg-surface border border-border text-sm hover:border-red-primary/40 hover:text-red-primary transition-colors"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </FadeIn>

        <FadeIn direction="up" delay={0.25}>
          <h2 className="text-2xl font-display font-semibold tracking-tight mb-4">
            Other mobile services
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {otherServices.map((s) => (
              <Link
                key={s.slug}
                href={`/services/${s.slug}`}
                className="p-4 rounded-xl border border-border bg-surface hover:border-red-primary/40 transition-colors"
              >
                <span className="font-medium block mb-1">{s.shortName}</span>
                <span className="text-xs text-text-secondary">
                  {s.typicalDuration} · {s.estimatedRange}
                </span>
              </Link>
            ))}
          </div>
        </FadeIn>
      </section>
    </main>
  );
}
