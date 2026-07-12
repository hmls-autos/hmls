"use client";

import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

// biome-ignore lint/suspicious/noShadowRestrictedNames: Next.js requires this name
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col bg-background text-text">
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="text-center boundary-enter">
          <div className="w-24 h-24 rounded-full bg-red-light flex items-center justify-center mx-auto mb-6 boundary-pop">
            <AlertTriangle className="w-12 h-12 text-red-primary" />
          </div>

          <h1 className="text-2xl md:text-3xl font-display font-semibold text-text mb-4 boundary-fade-up boundary-fade-up-1">
            Something went wrong
          </h1>

          <p className="text-text-secondary max-w-md mx-auto mb-8 boundary-fade-up boundary-fade-up-2">
            We encountered an unexpected error. Please try again or return to
            the homepage.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center boundary-fade-up boundary-fade-up-3">
            <button
              type="button"
              onClick={reset}
              className="hover-lift flex items-center justify-center gap-2 px-6 py-3 bg-red-primary text-white rounded-xl font-medium hover:bg-red-dark transition-colors"
            >
              <RefreshCw size={20} aria-hidden="true" />
              Try Again
            </button>
            <Link
              href="/"
              className="hover-lift flex items-center justify-center gap-2 px-6 py-3 bg-surface border border-border text-text rounded-xl font-medium hover:border-red-primary transition-colors"
            >
              <Home size={20} aria-hidden="true" />
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
