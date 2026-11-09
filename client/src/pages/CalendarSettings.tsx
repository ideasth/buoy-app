// Stage 17 — Calendar settings page (/settings/calendars).
// Served on apex (buoy.thinhalo.com) only. Two cards (family card retired 9 Nov 2026):
//   1. Public availability calendar (oliver-availability.thinhalo.com)
//   2. Private calendar subscription (apex /cal/private.ics)
// Plus a link to /settings/calendars/blocks.

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CalendarSettings {
  public_calendar_enabled: boolean;
  public_calendar_label: string | null;
  public_calendar_bookable_window_json: string | null;
  public_calendar_token: string | null;
  private_calendar_enabled: boolean;
  private_calendar_user: string | null;
  private_calendar_token: string | null;
}

const BOOKABLE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type BookableDay = (typeof BOOKABLE_DAYS)[number];

type BookableWindow = Record<BookableDay, [string, string] | null>;

const DEFAULT_WINDOW: BookableWindow = {
  mon: ["07:00", "19:00"],
  tue: ["07:00", "19:00"],
  wed: ["07:00", "19:00"],
  thu: ["07:00", "19:00"],
  fri: ["07:00", "19:00"],
  sat: ["08:00", "13:00"],
  sun: null,
};

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export default function CalendarSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<CalendarSettings>({
    queryKey: ["/api/settings/calendars"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/settings/calendars");
      return r.json();
    },
  });

  // Public calendar state
  const [pubEnabled, setPubEnabled] = useState(false);
  const [pubLabel, setPubLabel] = useState("Author Available (sanitised)");
  const [pubWindow, setPubWindow] = useState<BookableWindow>(DEFAULT_WINDOW);

  // Private calendar state
  const [privEnabled, setPrivEnabled] = useState(false);
  const [privUser, setPrivUser] = useState("");
  const [privPassword, setPrivPassword] = useState("");


  useEffect(() => {
    if (!data) return;
    setPubEnabled(data.public_calendar_enabled);
    setPubLabel(data.public_calendar_label ?? "Author Available (sanitised)");
    if (data.public_calendar_bookable_window_json) {
      try {
        setPubWindow(JSON.parse(data.public_calendar_bookable_window_json));
      } catch {}
    }
    setPrivEnabled(data.private_calendar_enabled);
    setPrivUser(data.private_calendar_user ?? "");
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      await apiRequest("PATCH", "/api/settings/calendars", patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/settings/calendars"] });
      toast({ title: "Saved" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const rotateMutation = useMutation({
    mutationFn: async (which: "public" | "private") => {
      const r = await apiRequest("POST", "/api/settings/calendars/rotate-token", { which });
      return r.json() as Promise<{ token: string }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/settings/calendars"] });
      toast({ title: "Token rotated. Update any subscribers." });
    },
    onError: () => toast({ title: "Rotate failed", variant: "destructive" }),
  });

  function savePublic() {
    saveMutation.mutate({
      public_calendar_enabled: pubEnabled,
      public_calendar_label: pubLabel,
      public_calendar_bookable_window_json: JSON.stringify(pubWindow),
    });
  }

  function savePrivate() {
    const patch: Record<string, unknown> = {
      private_calendar_enabled: privEnabled,
      private_calendar_user: privUser,
    };
    if (privPassword) patch.private_calendar_password = privPassword;
    saveMutation.mutate(patch);
    setPrivPassword("");
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;

  const pubToken = data?.public_calendar_token ?? "";
  const privToken = data?.private_calendar_token ?? "";
  const privUser_ = data?.private_calendar_user ?? "";

  const pubIcsUrl = `https://oliver-availability.thinhalo.com/elgin.ics?t=${pubToken}`;
  const pubHtmlUrl = `https://oliver-availability.thinhalo.com/?t=${pubToken}`;
  const privBasicUrl = `https://${privUser_}@buoy.thinhalo.com/cal/private.ics`;
  const privTokenUrl = `https://buoy.thinhalo.com/cal/private/${privToken}.ics`;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Calendar settings</h1>
        <a
          href="/#/settings/calendars/blocks"
          className="text-sm text-primary underline"
        >
          Manual overrides
        </a>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Card 1 — Public availability calendar */}
      {/* ------------------------------------------------------------------ */}
      <section className="border rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Public availability calendar</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pubEnabled}
              onChange={(e) => setPubEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div>
          <label className="text-sm text-muted-foreground">Calendar label</label>
          <input
            className="w-full border rounded px-2 py-1 text-sm mt-0.5"
            value={pubLabel}
            onChange={(e) => setPubLabel(e.target.value)}
          />
        </div>

        <div>
          <div className="text-sm text-muted-foreground mb-1">HTML page URL</div>
          <div className="flex gap-2">
            <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
              {pubHtmlUrl}
            </code>
            <button
              onClick={() => copyToClipboard(pubHtmlUrl)}
              className="text-xs px-3 py-1 border rounded shrink-0"
            >
              Copy
            </button>
          </div>
        </div>

        <div>
          <div className="text-sm text-muted-foreground mb-1">ICS subscribe URL</div>
          <div className="flex gap-2">
            <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
              {pubIcsUrl}
            </code>
            <button
              onClick={() => copyToClipboard(pubIcsUrl)}
              className="text-xs px-3 py-1 border rounded shrink-0"
            >
              Copy
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            if (confirm("Rotate token? All existing subscribers must update their URL.")) {
              rotateMutation.mutate("public");
            }
          }}
          className="text-sm px-3 py-1 border rounded"
        >
          Rotate token
        </button>

        {/* Bookable window editor */}
        <div>
          <div className="text-sm font-medium mb-2">Bookable window</div>
          <div className="space-y-2">
            {BOOKABLE_DAYS.map((day) => {
              const entry = pubWindow[day];
              return (
                <div key={day} className="flex items-center gap-3 text-sm">
                  <span className="w-8 uppercase text-muted-foreground">{day}</span>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={entry !== null}
                      onChange={(e) => {
                        setPubWindow((w) => ({
                          ...w,
                          [day]: e.target.checked ? DEFAULT_WINDOW[day] ?? ["07:00", "19:00"] : null,
                        }));
                      }}
                    />
                    Enabled
                  </label>
                  {entry && (
                    <>
                      <input
                        type="time"
                        className="border rounded px-1 py-0.5 text-xs"
                        value={entry[0]}
                        onChange={(e) =>
                          setPubWindow((w) => ({ ...w, [day]: [e.target.value, entry[1]] }))
                        }
                      />
                      <span className="text-muted-foreground">—</span>
                      <input
                        type="time"
                        className="border rounded px-1 py-0.5 text-xs"
                        value={entry[1]}
                        onChange={(e) =>
                          setPubWindow((w) => ({ ...w, [day]: [entry[0], e.target.value] }))
                        }
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <button
          onClick={savePublic}
          className="px-4 py-1 text-sm bg-primary text-primary-foreground rounded"
        >
          Save public calendar settings
        </button>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Card 2 — Private calendar subscription */}
      {/* ------------------------------------------------------------------ */}
      <section className="border rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Private calendar subscription</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={privEnabled}
              onChange={(e) => setPrivEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div>
          <label className="text-sm text-muted-foreground">Username</label>
          <input
            className="w-full border rounded px-2 py-1 text-sm mt-0.5"
            value={privUser}
            onChange={(e) => setPrivUser(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm text-muted-foreground">Password (write-only — leave blank to keep current)</label>
          <input
            type="password"
            className="w-full border rounded px-2 py-1 text-sm mt-0.5"
            value={privPassword}
            onChange={(e) => setPrivPassword(e.target.value)}
            placeholder="Set new password..."
          />
        </div>

        <div>
          <div className="text-sm text-muted-foreground mb-1">Basic-auth subscribe URL</div>
          <div className="flex gap-2">
            <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
              {privBasicUrl}
            </code>
            <button
              onClick={() => copyToClipboard(privBasicUrl)}
              className="text-xs px-3 py-1 border rounded shrink-0"
            >
              Copy
            </button>
          </div>
        </div>

        <div>
          <div className="text-sm text-muted-foreground mb-1">Token subscribe URL</div>
          <div className="flex gap-2">
            <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
              {privTokenUrl}
            </code>
            <button
              onClick={() => copyToClipboard(privTokenUrl)}
              className="text-xs px-3 py-1 border rounded shrink-0"
            >
              Copy
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            if (confirm("Rotate private calendar token? Update subscribed devices.")) {
              rotateMutation.mutate("private");
            }
          }}
          className="text-sm px-3 py-1 border rounded"
        >
          Rotate token
        </button>

        <button
          onClick={savePrivate}
          className="px-4 py-1 text-sm bg-primary text-primary-foreground rounded"
        >
          Save private calendar settings
        </button>
      </section>
    </div>
  );
}
