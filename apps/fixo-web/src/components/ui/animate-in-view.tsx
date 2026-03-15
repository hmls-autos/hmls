"use client";

import { useRef, useEffect, useState, type ReactNode } from "react";

export function AnimateInView({
  children,
  className = "",
  animation = "animate-in fade-in slide-in-from-bottom-4 duration-400 fill-mode-both",
  delay,
  margin = "-40px",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  animation?: string;
  delay?: number;
  margin?: string;
  as?: "div" | "section";
}) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.unobserve(el);
        }
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [margin]);

  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`${className} ${inView ? animation : "opacity-0"}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
