import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { apiRequest, setStoredToken } from "@/lib/queryClient";

interface AuthStatus {
  hasPassphrase: boolean;
  authenticated: boolean;
}

export default function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/status");
        const json = (await res.json()) as AuthStatus;
        setStatus(json);
      } catch {
        setStatus({ hasPassphrase: false, authenticated: false });
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!status) return;
    if (!status.hasPassphrase) {
      if (passphrase.length < 8) {
        setError("Passphrase must be at least 8 characters.");
        return;
      }
      if (passphrase !== confirm) {
        setError("Passphrases don't match.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const url = status.hasPassphrase ? "/api/auth/login" : "/api/auth/setup";
      const body: any = { passphrase };
      if (deviceLabel.trim()) body.deviceLabel = deviceLabel.trim();
      try {
        const res = await apiRequest("POST", url, body);
        const json = (await res.json().catch(() => ({}))) as { token?: string };
        if (json?.token) {
          setStoredToken(json.token);
        }
        onAuthenticated();
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (msg.startsWith("429")) {
          setError("Too many failed attempts. Try again in a few minutes.");
        } else {
          // apiRequest throws "<status>: <body>"; try to extract a json error
          const m = msg.match(/^\d+:\s*(.*)$/);
          let detail = m ? m[1] : msg;
          try {
            const j = JSON.parse(detail);
            detail = j?.error || detail;
          } catch {}
          setError(detail || "Could not sign in.");
        }
        setSubmitting(false);
        return;
      }
    } catch (err: any) {
      setError(err?.message || "Network error");
      setSubmitting(false);
    }
  }

  if (!status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  const setup = !status.hasPassphrase;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm" data-testid="card-login">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto" aria-label="Anchor logo">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="10" r="4" stroke="currentColor" strokeWidth="2" />
              <path d="M20 14 V32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M14 20 H26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M8 28 C 8 33, 14 36, 20 36 C 26 36, 32 33, 32 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </div>
          <CardTitle className="text-xl">Anchor</CardTitle>
          <CardDescription>
            {setup
              ? "Pick a passphrase to lock this app to you. Single passphrase, kept private to you — no account, no email."
              : "Enter your passphrase to continue."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="passphrase">Passphrase</Label>
              <Input
                id="passphrase"
                type="password"
                autoFocus
                autoComplete={setup ? "new-password" : "current-password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                data-testid="input-passphrase"
              />
            </div>
            {setup && (
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm passphrase</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  data-testid="input-confirm"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="deviceLabel">Device label (optional)</Label>
              <Input
                id="deviceLabel"
                placeholder="iPhone, MacBook…"
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                data-testid="input-device-label"
              />
            </div>
            {error && (
              <div
                className="text-sm text-destructive"
                role="alert"
                data-testid="text-login-error"
              >
                {error}
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !passphrase}
              data-testid="button-submit"
            >
              {submitting ? "…" : setup ? "Set passphrase" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
