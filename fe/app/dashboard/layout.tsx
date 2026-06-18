import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { DashboardProviders } from "@/components/dashboard/providers";
import { Toaster } from "sonner";

// The dashboard shares the marketing site's typeface (Poppins, exposed as
// `--font-poppins` on <html> by the root layout) so type + weights match `/`.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProviders>
      <DashboardLayout>{children}</DashboardLayout>
      <Toaster richColors position="bottom-right" />
    </DashboardProviders>
  );
}
