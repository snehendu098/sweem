import { IconRail } from "./dx/icon-rail";

// Dashboard shell: icon-only rail + scrollable content area on a warm peach
// canvas (Finexa/Sweem v2 design). Each page renders its own header — the
// Overview owns the "Welcome back" hero + search bar from the reference.
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dx-shell">
      <IconRail />
      <main className="dx-main">{children}</main>
    </div>
  );
}
