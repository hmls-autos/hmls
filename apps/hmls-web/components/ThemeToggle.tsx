"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";

const options = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const switchTheme = useCallback(
    (value: string) => {
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => { ready: Promise<void> };
      };

      if (!doc.startViewTransition || !triggerRef.current) {
        setTheme(value);
        setOpen(false);
        return;
      }

      const btn = triggerRef.current;
      const rect = btn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      const transition = doc.startViewTransition(() => {
        setTheme(value);
      });

      transition.ready.then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 500,
            easing: "ease-in-out",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      });

      setOpen(false);
    },
    [setTheme],
  );

  if (!mounted) {
    return <div className="w-9 h-9" />;
  }

  const current = options.find((o) => o.value === theme) ?? options[0];
  const CurrentIcon = current.icon;

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary hover:text-text hover:bg-surface-hover transition-colors"
        aria-label={`Theme: ${current.label}`}
        aria-expanded={open}
        aria-haspopup="true"
        title={`Theme: ${current.label}`}
      >
        <CurrentIcon className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-full mb-2 md:bottom-auto md:top-full md:mb-0 md:mt-2 w-36 rounded-lg border border-border bg-surface shadow-lg py-1 z-50"
        >
          {options.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitem"
              onClick={() => switchTheme(value)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                theme === value
                  ? "text-red-primary bg-red-light"
                  : "text-text-secondary hover:text-text hover:bg-surface-hover"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
