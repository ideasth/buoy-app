import { Link, useLocation } from "wouter";
import { useTheme } from "@/hooks/use-theme";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Plus, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { LateModal } from "./LateModal";
import { QuickCaptureModal } from "./QuickCaptureModal";
import { cn } from "@/lib/utils";

// Sidebar nav. `divider: true` rows render a separator instead of a link.
// Stage 18 (2026-05-16) order: regulation tools (Check-in / Calm / Capture /
// Coach) sit at the top, followed by daily planning surfaces (Today /
// Calendar), then the existing groups. Admin is the consolidated
// Health + Usage + Settings page (see /pages/Admin.tsx).
export type NavItem = { href: string; label: string } | { divider: true };
export const NAV: NavItem[] = [
  { href: "/checkin", label: "Check-in" },
  { href: "/calm", label: "Calm" },
  { href: "/capture", label: "Capture" },
  { href: "/coach", label: "Coach" },
  { divider: true },
  { href: "/", label: "Today" },
  { href: "/calendar-planner", label: "Calendar" },
  { divider: true },
  { href: "/morning", label: "Morning" },
  { href: "/evening", label: "Evening" },
  { href: "/review", label: "Review" },
  { divider: true },
  { href: "/tasks", label: "Tasks/Priorities" },
  { href: "/email-status", label: "Email Status" },
  { href: "/projects", label: "Projects" },
  { href: "/issues", label: "Issues" },
  { href: "/habits", label: "Habits" },
  { divider: true },
  { href: "/admin", label: "Admin" },
];

// Stage 18 — flattened list of selectable landing pages (dividers excluded).
// Consumed by the Admin settings dropdown and by tests that need to know
// which routes the user is allowed to pick as their default. Kept in sync
// with the server-side ALLOWED_LANDING_ROUTES allow-list in app-settings.ts.
export const NAV_ROUTES: ReadonlyArray<{ href: string; label: string }> =
  NAV.filter((item): item is { href: string; label: string } => !("divider" in item));

export function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const [location] = useLocation();
  const [lateOpen, setLateOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);

  // Global hotkey: ⌘/Ctrl+K opens Quick Capture from anywhere. Skipped when
  // the active element is a contenteditable region (so it doesn't fight with
  // editors that bind the same key) and on the /capture page itself (where
  // the full form already has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        const ae = document.activeElement as HTMLElement | null;
        if (ae?.isContentEditable) return;
        if (location === "/capture") return;
        e.preventDefault();
        setQuickCaptureOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [location]);

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-background">
      {/* Sidebar */}
      <aside className="md:w-56 md:flex-shrink-0 md:sticky md:top-0 md:self-start md:h-screen md:overflow-y-auto md:border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="px-5 py-5 flex items-center justify-between md:block">
          <div className="flex items-center gap-2">
            <Logo className="h-5 w-5 text-primary" />
            <div className="font-semibold tracking-tight">Buoy</div>
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
          {NAV.map((item, idx) => {
            if ("divider" in item) {
              // On md+ a horizontal rule; on mobile (horizontal-scroll nav) a thin
              // vertical divider so groups still feel separated.
              return (
                <div
                  key={`div-${idx}`}
                  role="separator"
                  aria-orientation="horizontal"
                  className="md:my-1 md:h-px md:w-full md:bg-sidebar-border md:mx-1 mx-1 my-2 w-px h-6 bg-sidebar-border self-center shrink-0"
                />
              );
            }
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
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
            onClick={() => setQuickCaptureOpen(true)}
            data-testid="button-quick-capture"
            title="⌘K"
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
      <QuickCaptureModal
        open={quickCaptureOpen}
        onOpenChange={setQuickCaptureOpen}
      />
    </div>
  );
}
