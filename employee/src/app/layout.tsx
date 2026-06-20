import type { Metadata } from "next";
import { Poppins, Geist, Inter } from "next/font/google";
import { SmoothScroll } from "@/components/providers/smooth-scroll";
import { EmployeeShell } from "@/components/dashboard/employee-shell";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Sweem Portal — your salary stream on Sui",
  description: "Claim your streamed salary per second and earn yield on idle pay — on Sui.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full",
        "antialiased",
        poppins.variable,
        "font-sans",
        geist.variable,
        inter.variable
      )}
    >
      <body className="min-h-full flex flex-col">
        <SmoothScroll>
          <EmployeeShell>{children}</EmployeeShell>
        </SmoothScroll>
      </body>
    </html>
  );
}
