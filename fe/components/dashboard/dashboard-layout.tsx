"use client";

import { useState } from "react";
import { BackgroundRippleEffect } from "@/components/ui/background-ripple-effect";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="dashboard-shell">
      <Navbar onMenuClick={() => setSidebarOpen((open) => !open)} />
      <div className="dashboard-main-row">
        <Sidebar
          open={sidebarOpen}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
        />
        <main className="dashboard-content-scroll">
          <BackgroundRippleEffect />
          <div className="dashboard-content-layer">{children}</div>
        </main>
      </div>
    </div>
  );
}
