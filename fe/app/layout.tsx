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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sweem.org";
const TITLE = "Sweem | Streaming Payroll on Sui";
const TITLE_TEMPLATE = "%s | Sweem";
const OG_DESC =
  "Sweem streams salaries to your team per second on Sui and earns yield on idle payroll across Navi, Scallop, Suilend and more. Fund once, pay continuously, claim anytime.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: TITLE_TEMPLATE,
  },
  description: OG_DESC,
  applicationName: "Sweem",
  authors: [{ name: "Sweem" }],
  creator: "Sweem",
  publisher: "Sweem",
  category: "finance",
  keywords: [
    "Sweem",
    "streaming payroll",
    "Sui payroll",
    "crypto payroll",
    "onchain payroll",
    "salary streaming",
    "USDC payroll",
    "web3 payroll",
    "DeFi yield",
    "Navi",
    "Scallop",
    "Suilend",
    "real-time salary",
    "Sui blockchain",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    siteName: "Sweem",
    url: SITE_URL,
    locale: "en_US",
    title: TITLE,
    description: OG_DESC,
    images: [{ url: "/sweem-thumbnail.png", width: 1920, height: 1080, alt: "Sweem — streaming payroll on Sui" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: OG_DESC,
    images: ["/sweem-thumbnail.png"],
  },
};

// Structured data so search engines render Sweem as a recognised software product.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Sweem",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description: OG_DESC,
  image: `${SITE_URL}/sweem-thumbnail.png`,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: {
    "@type": "Organization",
    name: "Sweem",
    url: SITE_URL,
    logo: `${SITE_URL}/sweem.png`,
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
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
