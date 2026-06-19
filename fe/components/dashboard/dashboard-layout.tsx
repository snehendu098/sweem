"use client";

import { useState } from "react";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="sw-dash flex h-screen w-full overflow-hidden bg-[var(--sw-bg)] text-[var(--sw-text)]">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,rgba(188,174,247,0.05),transparent_55%)]" />

      <Sidebar
        open={sidebarOpen}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Mobile scrim */}
      {sidebarOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
        />
      )}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Navbar onMenuClick={() => setSidebarOpen((open) => !open)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
