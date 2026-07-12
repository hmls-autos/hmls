import { Home, Search } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col bg-background text-text">
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="text-center boundary-enter">
          <div className="mb-6 boundary-fade-up">
            <span className="text-[150px] md:text-[200px] font-display font-extrabold leading-none bg-gradient-to-b from-red-primary to-red-dark bg-clip-text text-transparent">
              404
            </span>
          </div>

          <h1 className="text-2xl md:text-3xl font-display font-semibold text-text mb-4 boundary-fade-up boundary-fade-up-1">
            Page Not Found
          </h1>

          <p className="text-text-secondary max-w-md mx-auto mb-8 boundary-fade-up boundary-fade-up-2">
            The page you're looking for doesn't exist or has been moved. Let's
            get you back on track.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center boundary-fade-up boundary-fade-up-3">
            <Link
              href="/"
              className="hover-lift flex items-center justify-center gap-2 px-6 py-3 bg-red-primary text-white rounded-xl font-medium hover:bg-red-dark transition-colors"
            >
              <Home size={20} aria-hidden="true" />
              Back to Home
            </Link>
            <Link
              href="/chat"
              className="hover-lift flex items-center justify-center gap-2 px-6 py-3 bg-surface border border-border text-text rounded-xl font-medium hover:border-red-primary transition-colors"
            >
              <Search size={20} aria-hidden="true" />
              Chat with Us
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
