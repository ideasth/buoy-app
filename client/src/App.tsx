import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { Layout } from "@/components/Layout";
import NotFound from "@/pages/not-found";
// Eagerly imported pages (small, hit on first paint or near-first paint).
import Today from "@/pages/Today";
import Capture from "@/pages/Capture";
import Priorities from "@/pages/Priorities";
import HabitsPage from "@/pages/Habits";
import Evening from "@/pages/Evening";
import Review from "@/pages/Review";
import Morning from "@/pages/Morning";
import CheckIn from "@/pages/CheckIn";
import EmailStatus from "@/pages/EmailStatus";
import Projects from "@/pages/Projects";
import ProjectDetail from "@/pages/ProjectDetail";
import Issues from "@/pages/Issues";
import Login from "@/pages/Login";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

// Lazily imported pages — the heavy ones. Each becomes its own JS chunk so
// initial paint doesn't have to download Coach + CalendarPlanner + the
// Settings/Usage panels embedded in Admin. Loaded on first navigation.
const Coach = lazy(() => import("@/pages/Coach"));
const CalendarPlanner = lazy(() => import("@/pages/CalendarPlanner"));
const Admin = lazy(() => import("@/pages/Admin"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const Usage = lazy(() => import("@/pages/Usage"));

// Tiny fallback shown for the few hundred ms each lazy chunk takes to fetch.
// Intentionally minimal — a centred spinner string is less jarring than a
// full skeleton on a route the user just clicked.
function LazyFallback() {
  return (
    <div className="p-8 text-sm text-muted-foreground italic">Loading…</div>
  );
}

// Wraps the hash-location hook to strip any `?query` segment from the path
// before wouter matches routes. This lets us deep-link to /admin?tab=settings
// (used by the SettingsRedirect / UsageRedirect components below) while still
// matching the plain `/admin` route. The setter is unchanged, so navigations
// can still pass a query and Admin.tsx will read it from window.location.hash.
function useHashLocationStripQuery(): [string, (to: string, opts?: any) => void] {
  const [hashPath, navigate] = useHashLocation();
  const qIdx = hashPath.indexOf("?");
  const pathOnly = qIdx >= 0 ? hashPath.slice(0, qIdx) : hashPath;
  return [pathOnly, navigate as (to: string, opts?: any) => void];
}

// Lightweight redirect components for the legacy /settings and /usage paths.
// They land on /admin with the right tab pre-selected via ?tab=.
function SettingsRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/admin?tab=settings", { replace: true });
  }, [navigate]);
  return null;
}
function UsageRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/admin?tab=usage", { replace: true });
  }, [navigate]);
  return null;
}

// Stage 9a (2026-05-10): the page formerly known as /reflect now lives
// at /evening. Old bookmarks and inbound links continue to work via
// this client-side redirect.
function ReflectRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/evening", { replace: true });
  }, [navigate]);
  return null;
}

function AppRouter() {
  return (
    <Suspense fallback={<LazyFallback />}>
    <Switch>
      <Route path="/" component={Today} />
      <Route path="/morning" component={Morning} />
      <Route path="/capture" component={Capture} />
      <Route path="/email-status" component={EmailStatus} />
      <Route path="/projects/:id" component={ProjectDetail} />
      <Route path="/projects" component={Projects} />
      <Route path="/priorities" component={Priorities} />
      <Route path="/habits" component={HabitsPage} />
      <Route path="/evening" component={Evening} />
      {/* Legacy redirect: /reflect → /evening (Stage 9a). */}
      <Route path="/reflect" component={ReflectRedirect} />
      <Route path="/checkin" component={CheckIn} />
      <Route path="/coach" component={Coach} />
      <Route path="/review" component={Review} />
      <Route path="/issues" component={Issues} />
      <Route path="/calendar-planner" component={CalendarPlanner} />
      {/* Legacy redirects — keep deep links + bookmarks working */}
      <Route path="/calendar" component={CalendarPlanner} />
      <Route path="/planner" component={CalendarPlanner} />
      {/* Settings and Usage are now tabs inside /admin. Preserve old links. */}
      <Route path="/settings" component={SettingsRedirect} />
      <Route path="/usage" component={UsageRedirect} />
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

// Auto-redirect to /morning before 09:00 Australia/Melbourne if morning isn't done.
function MorningGuard() {
  const [location, navigate] = useLocation();
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    if (location === "/morning" || location === "/admin" || location === "/settings") return;

    // Use Intl to read Melbourne hour cheaply.
    const melbHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Australia/Melbourne",
        hour: "2-digit",
        hour12: false,
      })
        .formatToParts(new Date())
        .find((p) => p.type === "hour")?.value ?? "0",
    );
    if (melbHour >= 9) return;

    checked.current = true;
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/morning/today");
        const json = (await res.json()) as { completedAt?: number | null };
        if (!json.completedAt) {
          navigate("/morning");
        }
      } catch {
        // ignore
      }
    })();
  }, [location, navigate]);

  return null;
}

type AuthStatus = { hasPassphrase: boolean; authenticated: boolean };

function AuthGate() {
  const [status, setStatus] = useState<AuthStatus | "loading">("loading");

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const res = await apiRequest("GET", "/api/auth/status");
      const json = (await res.json()) as AuthStatus;
      setStatus(json);
    } catch {
      setStatus({ hasPassphrase: false, authenticated: false });
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (!status.authenticated) {
    return (
      <Login
        onAuthenticated={() => {
          // Optimistically mark authenticated. The token has already been
          // stored in localStorage by Login.tsx; subsequent requests will
          // carry the Authorization header. Skipping a re-fetch here avoids
          // a race where the immediate /api/auth/status fires before the
          // new token reaches buildHeaders().
          setStatus({ hasPassphrase: true, authenticated: true });
        }}
      />
    );
  }

  return (
    <Router hook={useHashLocationStripQuery}>
      <MorningGuard />
      <Layout>
        <AppRouter />
      </Layout>
    </Router>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <AuthGate />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
