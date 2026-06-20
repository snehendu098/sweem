import { Toaster } from "sonner";
import { DashboardProviders } from "@/components/dashboard/providers";
import { RequireWallet } from "@/components/dashboard/require-wallet";
import { OnboardingChrome } from "@/components/onboarding/onboarding-chrome";

// Onboarding has its own minimal chrome (wallet providers, no org sidebar). Root
// layout already supplies fonts + SmoothScroll + html/body. Disconnected visitors
// are bounced to `/` (landing) by RequireWallet.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProviders>
      <RequireWallet>
        <OnboardingChrome>{children}</OnboardingChrome>
      </RequireWallet>
      <Toaster richColors position="bottom-right" />
    </DashboardProviders>
  );
}
