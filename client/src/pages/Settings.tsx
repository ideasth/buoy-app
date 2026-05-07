import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, setStoredToken } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { domainLabel } from "@/lib/anchor";

interface SettingsView {
  adhd_tax_coefficient: number;
  briefing_time: string;
  timezone: string;
  theme: string;
  habits_seeded: boolean;
  calendar_ics_url_masked: string;
}

export default function SettingsPage() {
  const q = useQuery<SettingsView>({ queryKey: ["/api/settings"] });
  const { toast } = useToast();

  const [coef, setCoef] = useState("");
  const [briefingTime, setBriefingTime] = useState("");
  const [icsUrl, setIcsUrl] = useState("");

  useEffect(() => {
    if (q.data) {
      setCoef(String(q.data.adhd_tax_coefficient));
      setBriefingTime(q.data.briefing_time);
    }
  }, [q.data]);

  const save = async () => {
    const patch: any = {
      adhd_tax_coefficient: Number(coef) || 1.5,
      briefing_time: briefingTime,
    };
    if (icsUrl.trim()) patch.calendar_ics_url = icsUrl.trim();
    await apiRequest("PATCH", "/api/settings", patch);
    queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/today-events"] });
    setIcsUrl("");
    toast({ title: "Settings saved" });
  };

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 max-w-2xl space-y-8">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Settings</div>
        <h1 className="text-2xl font-semibold mt-1">Tune Anchor.</h1>
      </header>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="text-sm font-semibold">Time</h2>

        <div className="space-y-1.5">
          <Label htmlFor="coef">ADHD tax coefficient</Label>
          <Input
            id="coef"
            type="number"
            step="0.05"
            min="0.5"
            max="4"
            value={coef}
            onChange={(e) => setCoef(e.target.value)}
            data-testid="input-coef"
          />
          <div className="text-xs text-muted-foreground">
            Default 1.5 — Anchor recomputes a rolling average from your last 20 completed tasks.
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="briefing">Daily briefing time</Label>
          <Input
            id="briefing"
            type="time"
            value={briefingTime}
            onChange={(e) => setBriefingTime(e.target.value)}
            data-testid="input-briefing-time"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Timezone</Label>
          <Input value={q.data?.timezone ?? "Australia/Melbourne"} readOnly />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="text-sm font-semibold">Calendar feed</h2>
        <div className="space-y-1.5">
          <Label>Current URL (masked)</Label>
          <Input
            value={q.data?.calendar_ics_url_masked ?? ""}
            readOnly
            className="font-mono text-xs"
            data-testid="input-current-ics"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ics">Replace ICS URL</Label>
          <Input
            id="ics"
            placeholder="https://… (with embedded PAT if private)"
            value={icsUrl}
            onChange={(e) => setIcsUrl(e.target.value)}
            data-testid="input-new-ics"
            className="font-mono text-xs"
          />
          <div className="text-xs text-muted-foreground">
            Stored server-side. Never sent to the browser.
          </div>
        </div>
      </section>

      <Button onClick={save} data-testid="button-save-settings">
        Save settings
      </Button>

      <SecuritySection />

      <section className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
        Anchor is single-user, private. Data stored locally in SQLite. Calendar PAT never leaves the
        server.
      </section>
    </div>
  );
}

interface AuthSessionView {
  id: number;
  deviceLabel: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  isCurrent: boolean;
}

function SecuritySection() {
  const { toast } = useToast();
  const sessionsQ = useQuery<AuthSessionView[]>({ queryKey: ["/api/auth/sessions"] });
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const revoke = async (id: number) => {
    try {
      await apiRequest("POST", `/api/auth/sessions/${id}/revoke`);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
      toast({ title: "Session revoked" });
    } catch (err) {
      toast({ title: "Revoke failed", description: String(err), variant: "destructive" });
    }
  };

  const revokeOthers = async () => {
    try {
      await apiRequest("POST", "/api/auth/sessions/revoke-others");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
      toast({ title: "Other sessions revoked" });
    } catch (err) {
      toast({ title: "Failed", description: String(err), variant: "destructive" });
    }
  };

  const changePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) {
      toast({ title: "Too short", description: "At least 8 characters.", variant: "destructive" });
      return;
    }
    if (next !== confirm) {
      toast({ title: "Mismatch", description: "New passphrases don't match.", variant: "destructive" });
      return;
    }
    try {
      await apiRequest("POST", "/api/auth/passphrase", { current, new: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
      toast({ title: "Passphrase changed", description: "Other devices have been signed out." });
    } catch (err) {
      toast({ title: "Change failed", description: String(err), variant: "destructive" });
    }
  };

  const sessions = sessionsQ.data ?? [];
  const others = sessions.filter((s) => !s.isCurrent);
  const currentSession = sessions.find((s) => s.isCurrent);

  const logout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch (err) {
      // Even if logout fails server-side, still clear token locally.
      console.warn("logout request failed", err);
    } finally {
      setStoredToken(null);
      window.location.reload();
    }
  };

  return (
    <section className="space-y-5 rounded-lg border bg-card p-5" data-testid="section-security">
      <div>
        <h2 className="text-sm font-semibold">Security</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Single-passphrase gate. Sessions last 90 days per device.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Sessions ({sessions.length})
        </div>
        <div className="rounded-md border divide-y">
          {currentSession && (
            <SessionRow
              s={currentSession}
              onRevoke={null}
              data-testid={`row-session-${currentSession.id}`}
            />
          )}
          {others.map((s) => (
            <SessionRow
              key={s.id}
              s={s}
              onRevoke={() => revoke(s.id)}
              data-testid={`row-session-${s.id}`}
            />
          ))}
          {sessions.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">No active sessions.</div>
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={revokeOthers}
            disabled={others.length === 0}
            data-testid="button-revoke-others"
          >
            Revoke all other sessions
          </Button>
          <Button size="sm" variant="outline" onClick={logout} data-testid="button-logout">
            Sign out this device
          </Button>
        </div>
      </div>

      <form className="space-y-3 pt-2 border-t" onSubmit={changePassphrase}>
        <div className="text-xs uppercase tracking-wider text-muted-foreground pt-3">
          Change passphrase
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pp-current">Current passphrase</Label>
          <Input
            id="pp-current"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            data-testid="input-current-passphrase"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pp-new">New passphrase</Label>
          <Input
            id="pp-new"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            data-testid="input-new-passphrase"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pp-confirm">Confirm new passphrase</Label>
          <Input
            id="pp-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            data-testid="input-confirm-passphrase"
          />
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={!current || !next}
          data-testid="button-change-passphrase"
        >
          Change passphrase
        </Button>
      </form>
    </section>
  );
}

function SessionRow({
  s,
  onRevoke,
}: {
  s: AuthSessionView;
  onRevoke: (() => void) | null;
}) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 text-sm"
      data-testid={`row-session-${s.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">
            {s.deviceLabel || "Unnamed device"}
          </span>
          {s.isCurrent && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">
              This device
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Last seen {new Date(s.lastSeenAt).toLocaleString()} · created{" "}
          {new Date(s.createdAt).toLocaleDateString()}
        </div>
      </div>
      {onRevoke && (
        <Button size="sm" variant="outline" onClick={onRevoke} data-testid={`button-revoke-${s.id}`}>
          Revoke
        </Button>
      )}
    </div>
  );
}

