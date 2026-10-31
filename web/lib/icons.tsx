import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

/** StateShift mark — a state hand-off between two workers. */
export function Logo(props: P) {
  return (
    <svg viewBox="0 0 28 28" fill="none" {...props}>
      <rect x="1.5" y="1.5" width="25" height="25" rx="7.5" fill="currentColor" />
      <path
        d="M8.5 10v6.5M8.5 13l5-3M13.5 10l-5 3M14.5 14.5v3M14.5 14.5l4.5-3V8.5M19 10.5V8.5H17"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Activity(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M22 12h-4l-3 9-6-18-3 9H2" />
    </svg>
  );
}

export function Plus(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ArrowSwap(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M4 9h13m0 0-3-3m3 3-3 3" />
      <path d="M20 15H7m0 0 3-3m-3 3 3 3" />
    </svg>
  );
}

export function ChevronRight(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function X(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function Sun(props: P) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function Moon(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

export function Refresh(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6" />
    </svg>
  );
}

export function Database(props: P) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  );
}

export function Gauge(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M12 14l3-4" />
      <path d="M3 18h18" />
    </svg>
  );
}

export function Clock(props: P) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

export function Bolt(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

export function Layers(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </svg>
  );
}

export function Check(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}
