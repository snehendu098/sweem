import type { Metadata } from "next";
import { Poppins, Geist, Inter } from "next/font/google";
import { SmoothScroll } from "@/components/providers/smooth-scroll";
import { DashboardProviders } from "@/components/dashboard/providers";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sweem.app";
const OG_DESC = "Stream salaries per second and earn yield on idle payroll, on Sui.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Sweem | Streaming payroll on Sui",
  description: OG_DESC,
  openGraph: {
    type: "website",
    siteName: "Sweem",
    url: SITE_URL,
    title: "Sweem | Streaming payroll on Sui",
    description: OG_DESC,
    images: [{ url: "/sweem-thumbnail.png", width: 1920, height: 1080, alt: "Sweem" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sweem | Streaming payroll on Sui",
    description: OG_DESC,
    images: ["/sweem-thumbnail.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("h-full", "antialiased", poppins.variable, "font-sans", geist.variable, inter.variable)}>
      <body className="min-h-full flex flex-col">
        {/* Wallet + react-query context is global so the landing page can connect
            and the connection persists into /dashboard and /onboarding without a
            provider remount. */}
        <DashboardProviders>
          <SmoothScroll>{children}</SmoothScroll>
        </DashboardProviders>
      </body>
    </html>
  );
}
