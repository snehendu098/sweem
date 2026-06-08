"use client";

import { useState } from "react";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="dashboard-shell">
      <Navbar onMenuClick={() => setSidebarOpen((open) => !open)} />
      <div className="dashboard-main-row">
        <Sidebar open={sidebarOpen} />
        <main className="dashboard-content-scroll">{children}</main>
      </div>
    </div>
  );
}
