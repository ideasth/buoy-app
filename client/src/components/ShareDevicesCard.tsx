// filepath: client/src/components/ShareDevicesCard.tsx
// Stage 26c — Admin > Share devices. Create, copy (once) and revoke the
// per-device tokens used by the "Share to Buoy" Apple Shortcut.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TokenRow {
  id: number;
  label: string;
  hint: string;
  createdAt: number;
  lastUsedAt: number | null;
  useCount: number;
  revokedAt: number | null;
}

const fmt = (ms: number | null) =>
  ms == null
    ? "never"
    : new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
      }).format(new Date(ms));

export function ShareDevicesCard() {
  const { toast } = useToast();
  const q = useQuery<{ tokens: TokenRow[] }>({ queryKey: ["/api/capture-tokens"] });
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ label: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = `${window.location.origin}/api/capture`;

  const create = async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/capture-tokens", { label: label.trim() });
      const j = await res.json();
      setFresh({ label: j.token.label, secret: j.secret });
      setLabel("");
      queryClient.invalidateQueries({ queryKey: ["/api/capture-tokens"] });
    } catch (err) {
      toast({ title: "Could not create token", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (t: TokenRow) => {
    if (!confirm(`Revoke the token for "${t.label}"? Its Shortcut will stop working.`)) return;
    await apiRequest("DELETE", `/api/capture-tokens/${t.id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/capture-tokens"] });
    toast({ title: "Token revoked" });
  };

  const copy = async (v: string, what: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast({ title: `${what} copied` });
    } catch {
      toast({ title: "Copy failed — select and copy by hand", variant: "destructive" });
    }
  };

  const tokens = q.data?.tokens ?? [];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Share to Buoy devices</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-4">
          <p className="text-muted-foreground">
            Each iPhone or Mac gets its own token. A token can only send captures to Buoy — it cannot read
            anything. Captures arrive as tasks under "Needs a look". Limit: 30 a minute per device.
          </p>
          <div className="flex gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              placeholder="Device name, e.g. Oliver's iPhone"
              maxLength={60}
              data-testid="input-share-device-label"
            />
            <Button onClick={create} disabled={!label.trim() || busy} data-testid="button-share-device-create">
              Create token
            </Button>
          </div>

          {fresh && (
            <div className="rounded-md border border-amber-400/60 bg-amber-50/60 dark:bg-amber-900/10 p-3 space-y-2" data-testid="share-token-fresh">
              <div className="font-medium">Token for {fresh.label} — copy it now, it won't be shown again.</div>
              <code className="block break-all text-xs bg-background rounded px-2 py-1 select-all">{fresh.secret}</code>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(fresh.secret, "Token")}>Copy token</Button>
                <Button size="sm" variant="outline" onClick={() => copy(endpoint, "Address")}>Copy address</Button>
                <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Done</Button>
              </div>
            </div>
          )}

          <div className="divide-y rounded-md border" data-testid="share-device-list">
            {tokens.length === 0 && <div className="p-3 text-muted-foreground">No devices yet.</div>}
            {tokens.map((t) => (
              <div key={t.id} className="p-3 flex items-center justify-between gap-3">
                <div className={t.revokedAt ? "opacity-50" : ""}>
                  <div className="font-medium">
                    {t.label} <span className="text-xs text-muted-foreground">…{t.hint}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.revokedAt
                      ? `Revoked ${fmt(t.revokedAt)}`
                      : `Created ${fmt(t.createdAt)} · last used ${fmt(t.lastUsedAt)} · ${t.useCount} capture${t.useCount === 1 ? "" : "s"}`}
                  </div>
                </div>
                {!t.revokedAt && (
                  <Button size="sm" variant="outline" onClick={() => revoke(t)} data-testid={`button-share-device-revoke-${t.id}`}>
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Set up the Shortcut (iPhone and Mac)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open Shortcuts, tap +, name it "Share to Buoy".</li>
            <li>Open the shortcut's settings (i): turn on "Show in Share Sheet". Accept URLs and Text. On Mac also tick "Use as Quick Action".</li>
            <li>Add "If Shortcut Input has any value". Otherwise branch: "Ask for Input" (Text, prompt "Capture").</li>
            <li>
              Add "Get Contents of URL": address <code className="text-xs">{endpoint}</code>, Method POST, Headers{" "}
              <code className="text-xs">Authorization</code> = <code className="text-xs">Bearer &lt;your token&gt;</code>,
              Request Body JSON with <code className="text-xs">text</code> = Shortcut Input (or Provided Input).
            </li>
            <li>Add "Show Notification": "Sent to Buoy".</li>
            <li>Test: share a web page from Safari, then look under Tasks → Needs a look.</li>
          </ol>
          <p className="text-muted-foreground">If a phone is lost, revoke its token here. Nothing else needs changing.</p>
        </CardContent>
      </Card>
    </div>
  );
}
