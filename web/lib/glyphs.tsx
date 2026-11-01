import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 15,
  height: 15,
  ...props,
});

export const GlyphConsole = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.6" />
    <path d="M2.2 6.4h11.6M6.4 6.4v7.4" />
  </svg>
);

export const GlyphJobs = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 4.2h10M3 8h10M3 11.8h6.5" />
  </svg>
);

export const GlyphSwap = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.6 5.4h8.2l-2-2M13.4 10.6H5.2l2 2" />
  </svg>
);

export const GlyphNodes = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.4" y="2.4" width="4.6" height="4.6" rx="1" />
    <rect x="9" y="2.4" width="4.6" height="4.6" rx="1" />
    <rect x="2.4" y="9" width="4.6" height="4.6" rx="1" />
    <rect x="9" y="9" width="4.6" height="4.6" rx="1" />
  </svg>
);

export const GlyphLogs = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.6 4.5h10.8M2.6 8h7.2M2.6 11.5h9" />
  </svg>
);

export const GlyphGear = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.9v1.7M8 12.4v1.7M1.9 8h1.7M12.4 8h1.7M3.7 3.7l1.2 1.2M11.1 11.1l1.2 1.2M12.3 3.7l-1.2 1.2M4.9 11.1l-1.2 1.2" />
  </svg>
);

export const GlyphSearch = (p: P) => (
  <svg {...base({ width: 13, height: 13, ...p })}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 14 14" />
  </svg>
);

export const GlyphPlus = (p: P) => (
  <svg {...base({ width: 13, height: 13, ...p })}>
    <path d="M8 3.2v9.6M3.2 8h9.6" />
  </svg>
);

export const GlyphX = (p: P) => (
  <svg {...base({ width: 13, height: 13, ...p })}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const GlyphArrow = (p: P) => (
  <svg {...base({ width: 12, height: 12, ...p })}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);
