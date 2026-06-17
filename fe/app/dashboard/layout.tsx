import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { DashboardProviders } from "@/components/dashboard/providers";
import { Toaster } from "sonner";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProviders>
      <DashboardLayout>{children}</DashboardLayout>
      <Toaster richColors position="bottom-right" />
    </DashboardProviders>
  );
}
