import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, setStoredToken } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, MapPin, CalendarCog, ChevronRight } from "lucide-react";
import { NAV_ROUTES } from "@/components/Layout";

interface SettingsView {
  adhd_tax_coefficient: number;
  briefing_time: string;
  timezone: string;
  theme: string;
  habits_seeded: boolean;
  calendar_ics_url_masked: string;
  home_address?: string;
  maps_provider?: string;
  // Stage 18 — user's chosen landing route. Falls back to "/" server-side.
  defaultLandingRoute?: string;
}

interface TravelLocation {
  id: number;
  name: string;
  keywords: string;
  nominalMinutes: number;
  allowMinutes: number;
  destinationAddress: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export default function SettingsPage() {
  const q = useQuery<SettingsView>({ queryKey: ["/api/settings"] });
  const { toast } = useToast();

  const [coef, setCoef] = useState("");
  const [briefingTime, setBriefingTime] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  // Stage 18 — default landing route. Persisted immediately on change
  // (not bundled into the Save button) so the picker behaves like a toggle.
  const [defaultLandingRoute, setDefaultLandingRoute] = useState<string>("/");

  useEffect(() => {
    if (q.data) {
      setCoef(String(q.data.adhd_tax_coefficient));
      setBriefingTime(q.data.briefing_time);
      setHomeAddress(q.data.home_address ?? "");
      setDefaultLandingRoute(q.data.defaultLandingRoute ?? "/");
    }
  }, [q.data]);

  const save = async () => {
    const patch: any = {
      adhd_tax_coefficient: Number(coef) || 1.5,
      briefing_time: briefingTime,
      home_address: homeAddress.trim(),
    };
    if (icsUrl.trim()) patch.calendar_ics_url = icsUrl.trim();
    await apiRequest("PATCH", "/api/settings", patch);
    queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/today-events"] });
    queryClient.invalidateQueries({ queryKey: ["/api/travel/today"] });
    setIcsUrl("");
    toast({ title: "Settings saved" });
  };

  const saveDefaultLandingRoute = async (next: string) => {
    setDefaultLandingRoute(next);
    try {
      const res = await apiRequest("PATCH", "/api/settings", {
        defaultLandingRoute: next,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`PATCH /api/settings failed: ${res.status} ${text.slice(0, 200)}`);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Default landing page saved" });
    } catch (err) {
      toast({
        title: "Could not save landing page",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 max-w-2xl space-y-8">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Settings</div>
        <h1 className="text-2xl font-semibold mt-1">Tune Buoy.</h1>
      </header>

      <section
        className="space-y-3 rounded-lg border bg-card p-5"
        data-testid="section-default-landing"
      >
        <h2 className="text-sm font-semibold">Default landing page</h2>
        <div className="space-y-1.5">
          <Label htmlFor="default-landing">
            The page Buoy opens to when you first load the app or open a new tab.
          </Label>
          <Select
            value={defaultLandingRoute}
            onValueChange={saveDefaultLandingRoute}
          >
            <SelectTrigger
              id="default-landing"
              data-testid="select-default-landing"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NAV_ROUTES.map((r) => (
                <SelectItem
                  key={r.href}
                  value={r.href}
                  data-testid={`option-default-landing-${r.href.replace(/^\//, "") || "today"}`}
                >
                  {r.label}
                  {r.href === "/" ? " (Today)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            Deep links to other pages still work — this only fires when you
            land on the root URL.
          </div>
        </div>
      </section>

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
            Default 1.5 — Buoy recomputes a rolling average from your last 20 completed tasks.
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

      <section className="rounded-lg border bg-card p-5" data-testid="section-calendar-publishing">
        <a
          href="/#/settings/calendars"
          className="flex items-center gap-3 -m-1 p-1 rounded hover:bg-muted/40 transition-colors"
          data-testid="link-calendar-publishing"
        >
          <CalendarCog className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Calendar publishing</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Public availability, private subscription, and family calendar — switches, tokens, and bookable windows.
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </a>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="text-sm font-semibold">Travel · home base</h2>
        <div className="space-y-1.5">
          <Label htmlFor="home-address">Home address (origin for Maps directions)</Label>
          <Input
            id="home-address"
            value={homeAddress}
            onChange={(e) => setHomeAddress(e.target.value)}
            placeholder="Erskine St, North Melbourne VIC 3051"
            data-testid="input-home-address"
          />
          <div className="text-xs text-muted-foreground">
            Used as the origin when opening Google Maps from a calendar event.
          </div>
        </div>
      </section>

      <Button onClick={save} data-testid="button-save-settings">
        Save settings
      </Button>

      <TravelLocationsSection />

      <SecuritySection />

      <section className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
        Buoy is single-user, private. Data stored locally in SQLite. Calendar PAT never leaves the
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

// ---- Travel locations CRUD --------------------------------------------------

function TravelLocationsSection() {
  const { toast } = useToast();
  // Server returns { locations: TravelLocation[] }. Unwrap defensively so a shape
  // change can't blank the whole Settings page (this was the symptom we hit).
  const q = useQuery<{ locations: TravelLocation[] } | TravelLocation[]>({
    queryKey: ["/api/travel-locations"],
  });
  const locations: TravelLocation[] = Array.isArray(q.data)
    ? q.data
    : q.data?.locations ?? [];

  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    keywords: string;
    nominalMinutes: string;
    allowMinutes: string;
    destinationAddress: string;
    notes: string;
  }>({ name: "", keywords: "", nominalMinutes: "", allowMinutes: "", destinationAddress: "", notes: "" });

  const startAdd = () => {
    setEditingId(null);
    setAdding(true);
    setDraft({ name: "", keywords: "", nominalMinutes: "30", allowMinutes: "45", destinationAddress: "", notes: "" });
  };
  const startEdit = (loc: TravelLocation) => {
    setAdding(false);
    setEditingId(loc.id);
    setDraft({
      name: loc.name,
      keywords: loc.keywords,
      nominalMinutes: String(loc.nominalMinutes),
      allowMinutes: String(loc.allowMinutes),
      destinationAddress: loc.destinationAddress ?? "",
      notes: loc.notes ?? "",
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setAdding(false);
  };

  const validateDraft = (): { ok: true; payload: any } | { ok: false; reason: string } => {
    const name = draft.name.trim();
    const keywords = draft.keywords.trim();
    const nominal = Number(draft.nominalMinutes);
    const allow = Number(draft.allowMinutes);
    if (!name) return { ok: false, reason: "Name is required." };
    if (!keywords) return { ok: false, reason: "At least one keyword is required." };
    if (!Number.isFinite(nominal) || nominal < 0 || nominal > 600)
      return { ok: false, reason: "Nominal minutes must be 0\u2013600." };
    if (!Number.isFinite(allow) || allow < 0 || allow > 600)
      return { ok: false, reason: "Allow minutes must be 0\u2013600." };
    return {
      ok: true,
      payload: {
        name,
        keywords,
        nominalMinutes: nominal,
        allowMinutes: allow,
        destinationAddress: draft.destinationAddress.trim() || null,
        notes: draft.notes.trim() || null,
      },
    };
  };

  const submit = async () => {
    const v = validateDraft();
    if (!v.ok) {
      toast({ title: "Cannot save", description: v.reason, variant: "destructive" });
      return;
    }
    try {
      if (editingId != null) {
        await apiRequest("PATCH", `/api/travel-locations/${editingId}`, v.payload);
      } else {
        await apiRequest("POST", "/api/travel-locations", v.payload);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/travel-locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/travel/today"] });
      setEditingId(null);
      setAdding(false);
      toast({ title: editingId ? "Location updated" : "Location added" });
    } catch (err) {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    }
  };

  const remove = async (loc: TravelLocation) => {
    if (!window.confirm(`Delete travel location "${loc.name}"?`)) return;
    try {
      await apiRequest("DELETE", `/api/travel-locations/${loc.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/travel-locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/travel/today"] });
      toast({ title: "Location deleted" });
    } catch (err) {
      toast({ title: "Delete failed", description: String(err), variant: "destructive" });
    }
  };

  return (
    <section className="space-y-3 rounded-lg border bg-card p-5" data-testid="section-travel-locations">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            Travel locations
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Calendar events whose summary or location contains any keyword inherit the location's drive
            time. On ties, the longest matched keyword wins.
          </p>
        </div>
        {!adding && editingId == null && (
          <Button size="sm" variant="outline" onClick={startAdd} data-testid="button-add-travel-location">
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {locations.length === 0 && !q.isLoading && !adding && (
          <div className="text-sm text-muted-foreground italic">No travel locations yet.</div>
        )}
        {locations.map((loc) => (
          <div key={loc.id} className="rounded-md border bg-background p-3" data-testid={`row-travel-${loc.id}`}>
            {editingId === loc.id ? (
              <TravelLocationForm draft={draft} setDraft={setDraft} onSave={submit} onCancel={cancelEdit} />
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-medium">{loc.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      drive ~{loc.nominalMinutes}m · allow {loc.allowMinutes}m
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    Keywords: {loc.keywords}
                  </div>
                  {loc.destinationAddress && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      → {loc.destinationAddress}
                    </div>
                  )}
                  {loc.notes && (
                    <div className="text-xs text-muted-foreground/80 mt-0.5 truncate">{loc.notes}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => startEdit(loc)}
                    data-testid={`button-edit-travel-${loc.id}`}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(loc)}
                    className="text-destructive"
                    data-testid={`button-delete-travel-${loc.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
        {adding && (
          <div className="rounded-md border bg-background p-3">
            <TravelLocationForm draft={draft} setDraft={setDraft} onSave={submit} onCancel={cancelEdit} />
          </div>
        )}
      </div>
    </section>
  );
}

function TravelLocationForm({
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  draft: {
    name: string;
    keywords: string;
    nominalMinutes: string;
    allowMinutes: string;
    destinationAddress: string;
    notes: string;
  };
  setDraft: (d: any) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Name</Label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Sandringham"
            data-testid="input-travel-name"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Keywords (comma-separated)</Label>
          <Input
            value={draft.keywords}
            onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
            placeholder="sandringham, sandi"
            data-testid="input-travel-keywords"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Nominal minutes (drive)</Label>
          <Input
            type="number"
            min="0"
            max="600"
            value={draft.nominalMinutes}
            onChange={(e) => setDraft({ ...draft, nominalMinutes: e.target.value })}
            data-testid="input-travel-nominal"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Allow minutes (with buffer)</Label>
          <Input
            type="number"
            min="0"
            max="600"
            value={draft.allowMinutes}
            onChange={(e) => setDraft({ ...draft, allowMinutes: e.target.value })}
            data-testid="input-travel-allow"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Destination address (optional, for Maps)</Label>
        <Input
          value={draft.destinationAddress}
          onChange={(e) => setDraft({ ...draft, destinationAddress: e.target.value })}
          placeholder="193 Bluff Rd, Sandringham VIC 3191"
          data-testid="input-travel-destination"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Notes (optional)</Label>
        <Input
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          data-testid="input-travel-notes"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={onSave} data-testid="button-save-travel">
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="button-cancel-travel">
          Cancel
        </Button>
      </div>
    </div>
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

