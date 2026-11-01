import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StateShift — live migration control plane",
  description:
    "Move a running workload between machines at a step boundary. One authoritative owner at a time, enforced by an epoch fence.",
};

/* Dark is the default canvas for this screen; only an explicit choice of
   light is persisted. Runs before paint so there is no flash. */
const themeInit = `(function(){try{if(localStorage.getItem("ss-theme")==="light"){document.documentElement.classList.add("light")}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* App Router has no pages/_document; the link is correct here. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
