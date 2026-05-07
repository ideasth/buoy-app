import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { Layout } from "@/components/Layout";
import NotFound from "@/pages/not-found";
import Today from "@/pages/Today";
import Capture from "@/pages/Capture";
import Priorities from "@/pages/Priorities";
import HabitsPage from "@/pages/Habits";
import Reflect from "@/pages/Reflect";
import Review from "@/pages/Review";
import CalendarPlanner from "@/pages/CalendarPlanner";
import SettingsPage from "@/pages/Settings";
import Morning from "@/pages/Morning";
import Usage from "@/pages/Usage";
import EmailStatus from "@/pages/EmailStatus";
import Projects from "@/pages/Projects";
import ProjectDetail from "@/pages/ProjectDetail";
import Login from "@/pages/Login";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Today} />
      <Route path="/morning" component={Morning} />
      <Route path="/capture" component={Capture} />
      <Route path="/email-status" component={EmailStatus} />
      <Route path="/projects/:id" component={ProjectDetail} />
      <Route path="/projects" component={Projects} />
      <Route path="/priorities" component={Priorities} />
      <Route path="/habits" component={HabitsPage} />
      <Route path="/reflect" component={Reflect} />
      <Route path="/review" component={Review} />
      <Route path="/calendar-planner" component={CalendarPlanner} />
      {/* Legacy redirects — keep deep links + bookmarks working */}
      <Route path="/calendar" component={CalendarPlanner} />
      <Route path="/planner" component={CalendarPlanner} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/usage" component={Usage} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Auto-redirect to /morning before 09:00 Australia/Melbourne if morning isn't done.
function MorningGuard() {
  const [location, navigate] = useLocation();
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    if (location === "/morning" || location === "/settings") return;

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
    <Router hook={useHashLocation}>
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
