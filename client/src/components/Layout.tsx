import { Link, useLocation } from "wouter";
import { useTheme } from "@/hooks/use-theme";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Plus, Phone } from "lucide-react";
import { useState } from "react";
import { LateModal } from "./LateModal";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/morning", label: "Morning" },
  { href: "/", label: "Today" },
  { href: "/capture", label: "Capture" },
  { href: "/email-status", label: "Email Status" },
  { href: "/projects", label: "Projects" },
  { href: "/priorities", label: "Priorities" },
  { href: "/calendar-planner", label: "Calendar" },
  { href: "/habits", label: "Habits" },
  { href: "/reflect", label: "Reflect" },
  { href: "/review", label: "Review" },
  { href: "/usage", label: "Usage" },
  { href: "/settings", label: "Settings" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const [location] = useLocation();
  const [lateOpen, setLateOpen] = useState(false);

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-background">
      {/* Sidebar */}
      <aside className="md:w-56 md:flex-shrink-0 md:min-h-screen md:border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="px-5 py-5 flex items-center justify-between md:block">
          <div className="flex items-center gap-2">
            <Logo className="h-5 w-5 text-primary" />
            <div className="font-semibold tracking-tight">Anchor</div>
          </div>
          <div className="md:hidden flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={toggle}
              data-testid="button-theme-toggle-mobile"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <nav className="px-2 pb-2 md:pb-0 flex md:flex-col gap-1 overflow-x-auto">
          {NAV.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
                className={cn(
                  "px-3 py-2 rounded-md text-sm whitespace-nowrap hover-elevate active-elevate-2",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/80",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block px-3 mt-4 space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => (window.location.hash = "#/capture")}
            data-testid="button-quick-capture"
          >
            <Plus className="h-4 w-4" />
            Quick capture
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-destructive"
            onClick={() => setLateOpen(true)}
            data-testid="button-running-late"
          >
            <Phone className="h-4 w-4" />
            I'm running late
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={toggle}
            data-testid="button-theme-toggle"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </Button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 w-full max-w-full pb-24 md:pb-8">{children}</main>

      {/* Floating "I'm late" button on mobile */}
      <button
        type="button"
        onClick={() => setLateOpen(true)}
        data-testid="button-late-fab"
        className="md:hidden fixed bottom-5 right-5 z-30 rounded-full px-4 py-3 text-sm font-medium shadow-lg bg-destructive text-destructive-foreground hover:opacity-90"
      >
        I'm late
      </button>

      <LateModal open={lateOpen} onOpenChange={setLateOpen} />
    </div>
  );
}
