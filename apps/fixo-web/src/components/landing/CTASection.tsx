import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimateInView } from "@/components/ui/animate-in-view";

export function CTASection() {
  return (
    <section className="py-24">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <AnimateInView>
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
        </AnimateInView>
      </div>
    </section>
  );
}
