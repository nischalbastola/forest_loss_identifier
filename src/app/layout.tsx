import type { Metadata, Viewport } from "next";
import { Fraunces, Geist_Mono, Outfit } from "next/font/google";

import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const description =
  "Classify Sentinel-2 satellite chips into 10 land types and flag forest that became farmland. A EuroSAT model that runs entirely in the browser.";

export const metadata: Metadata = {
  title: {
    default: "Clearcut — satellite land cover in the browser",
    template: "%s · Clearcut",
  },
  description,
  applicationName: "Clearcut",
  keywords: [
    "EuroSAT",
    "Sentinel-2",
    "land cover classification",
    "deforestation detection",
    "satellite imagery",
    "browser machine learning",
  ],
  openGraph: {
    title: "Clearcut — satellite land cover in the browser",
    description,
    type: "website",
    locale: "en_US",
    siteName: "Clearcut",
  },
  twitter: {
    card: "summary_large_image",
    title: "Clearcut — satellite land cover in the browser",
    description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#f3efe4",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${outfit.variable} ${fraunces.variable} ${mono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
