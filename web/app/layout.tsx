import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StateShift — live migration control plane",
  description:
    "Move a running workload between machines at a step boundary. One authoritative owner at a time, enforced by an epoch fence.",
};

/* Apply the persisted theme before paint so there is no flash of the wrong mode. */
const themeInit = `(function(){try{var t=localStorage.getItem("ss-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
