import { JsonLd } from "@/components/JsonLd";
import About from "@/components/sections/About";
import CTA from "@/components/sections/CTA";
import Hero from "@/components/sections/Hero";
import HowItWorks from "@/components/sections/HowItWorks";
import ServiceArea from "@/components/sections/ServiceArea";
import Services from "@/components/sections/Services";
import TrustBar from "@/components/sections/TrustBar";

export default function Home() {
  return (
    <main className="bg-background text-foreground">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "AutoRepair",
          name: "HMLS Mobile Mechanic",
          url: "https://hmls.autos",
          telephone: "+19492137073",
          email: "business@hmls.autos",
          areaServed: {
            "@type": "City",
            name: "Orange County",
            containedInPlace: {
              "@type": "State",
              name: "California",
            },
          },
          serviceType: [
            "Mobile Mechanic",
            "Oil Change",
            "Brake Repair",
            "Diagnostics",
          ],
          description:
            "Expert mobile mechanic service in Orange County. We come to you.",
        }}
      />
      <Hero />
      <TrustBar />
      <HowItWorks />
      <Services />
      <About />
      <ServiceArea />
      <CTA />
    </main>
  );
}
