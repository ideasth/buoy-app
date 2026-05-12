import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { fmtTime as fmtTimeShared, todayDateStr } from "@/lib/anchor";
import { TravelBadge } from "@/components/TravelBadge";
import type { TravelTodayItem } from "@/lib/travel";
import { leaveByLabel } from "@/lib/travel";

// Shared travel-today hook used by TodaySection and DayDrawer.
function useTravelTodayMap(enabled: boolean = true) {
  const q = useQuery<{ items: TravelTodayItem[] }>({
    queryKey: ["/api/travel/today"],
    refetchInterval: 60_000,
    enabled,
  });
  return useMemo(() => {
    const m = new Map<string, TravelTodayItem>();
    for (const it of q.data?.items ?? []) m.set(it.event.uid, it);
    return m;
  }, [q.data]);
}

interface CalEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
}

interface PlannerNote {
  id: number;
  date: string;
  note: string;
  updatedAt: number;
}

// --- Year-grouped column classifier -------------------------------------
//
// 2026-05-06 restructure (replaces the previous 4-group layout):
//
//   Oliver           : Oliver-All (single column — combined Elgin / Sandringham /
//                                  Peninsula / On-call / Travel / Medicolegal /
//                                  Personal, prefixed in the source feed)
//   Marieke          : Marieke Art (only — Marieke Personal & Studio removed)
//   Marieke & Oliver : Couple (couple time + tea + physio)
//   Family           : Kids with Us | Kids Activities | Kids Term Dates | Public Holidays
//
// The Oliver-All feed already prefixes events with [Elgin House] / [Sandringham] /
// [Peninsula Health] / [On-call] / [Travel] / [Medicolegal] / [Personal]. We keep a
// fallback substring scan for legacy / non-prefixed events.

type ColKey =
  | "oliver_all"
  | "m_art"
  | "couple"
  | "kids_with_us"
  | "kids_activities"
  | "family_notes"
  | "kids_terms"
  | "ph";

function columnFor(summary: string): ColKey | null {
  const raw = (summary || "").trim();
  const s = raw.toLowerCase();

  // 0. Family Notes — explicit prefix [Family Notes] from Anchor-generated feed.
  if (raw.startsWith("[Family Notes]") || s.startsWith("family note:")) {
    return "family_notes";
  }

  // 1. Couple (Marieke & Oliver) — match BEFORE Marieke so "Couple time" /
  //    "Marieke physio" don't fall through to the Marieke column.
  if (
    s.includes("couple time") ||
    s.includes("cup of tea") ||
    s.includes("marieke physio") ||
    s.includes("date night")
  ) {
    return "couple";
  }

  // 2. Marieke Art (the only Marieke column kept)
  if (
    s.includes("marieke art") ||
    s.includes("marieke \u2014 art") ||
    s.includes("marieke - art") ||
    s.includes("marieke \u2014 art class") ||
    s.includes("art class")
  ) {
    return "m_art";
  }

  // 3. Family — Kids buckets, term dates, public holidays
  if (s.includes("kids with us")) return "kids_with_us";
  if (s.includes("kids head off") || s.includes("kids back") || s.includes("handover")) {
    return "kids_with_us";
  }

  // School term/holiday banners
  if (
    s.includes("school term") ||
    s.includes("term ") ||
    s.includes(" term") ||
    s.includes("school holidays") ||
    s.includes("first day of school") ||
    s.includes("last day of school") ||
    (s.includes("school") && (s.includes("nmps") || s.includes("uhs")))
  ) {
    return "kids_terms";
  }

  // Public holidays — Vic public holidays + significant special days
  if (
    s.includes("public holiday") ||
    s.includes("anzac") ||
    s.includes("labour day") ||
    s.includes("kings birthday") ||
    s.includes("king's birthday") ||
    s.includes("queens birthday") ||
    s.includes("queen's birthday") ||
    s.includes("christmas") ||
    s.includes("boxing day") ||
    s.includes("new year") ||
    s.includes("good friday") ||
    s.includes("easter") ||
    s.includes("melbourne cup") ||
    s.includes("afl grand final") ||
    s.includes("australia day")
  ) {
    return "ph";
  }

  // Kids activities — anything Hilde:/Axel: prefixed (combined kids feed),
  // OR legacy "Hilde — …" / "Axel — …" lines.
  if (
    raw.startsWith("Hilde:") ||
    raw.startsWith("Axel:") ||
    raw.startsWith("Hilde \u2014") ||
    raw.startsWith("Axel \u2014") ||
    raw.startsWith("Hilde -") ||
    raw.startsWith("Axel -") ||
    s.startsWith("hilde ") ||
    s.startsWith("axel ")
  ) {
    return "kids_activities";
  }

  // 4. Oliver-All — match the [Category] prefixes the build script emits, plus
  //    legacy / unprefixed clinical events.
  if (
    raw.startsWith("[Elgin House]") ||
    raw.startsWith("[Sandringham]") ||
    raw.startsWith("[Peninsula Health]") ||
    raw.startsWith("[On-call]") ||
    raw.startsWith("[Travel]") ||
    raw.startsWith("[Medicolegal]") ||
    raw.startsWith("[Personal]")
  ) {
    return "oliver_all";
  }
  // Legacy keyword fallback
  const oliverKeys = [
    "elgin", "braybrook", "carlton",
    "sandringham", "sandy ", "anc (", "gynae ot",
    "peninsula", "pen wk", "urogyn", "medical student teaching",
    "on-call", "on call", "alfred (24h)",
    "travel \u2014", "travel -", "conference", "flight",
    "hotel \u2014", "hotel -",
    "annual leave", "rec leave", "rdo",
    "medicolegal",
    "gp \u2014", "gp -", "dental", "dentist", "haircut", "gym",
    "podiatry", "optometr", "oliver \u2014 personal", "personal medical",
    "ot \u2013 main", "ot \u2014 main", "ot - main", "caesar",
    "gyn clinic", "anc ", "theatre", "ward round", "handover round",
    "audit", "mdt", "teaching (am)", "teaching (pm)", "clinic",
    "timesheet", "roster",
  ];
  if (oliverKeys.some((k) => s.includes(k))) return "oliver_all";

  return null;
}

// Column order (left → right) requested 7 May 2026:
//   Oliver-All, Marieke Art, Kids with Us, Kids Activities, Family Notes,
//   Kids Term Dates, Public Holidays.
// Couple (Marieke & Oliver) was removed from the year view per user request.
const COL_DEFS: Array<{
  key: ColKey;
  label: string;
  group: "oliver" | "marieke" | "couple" | "family";
}> = [
  { key: "oliver_all",      label: "Oliver-All",       group: "oliver" },
  { key: "m_art",           label: "Marieke Art",      group: "marieke" },
  { key: "couple",          label: "Couple",           group: "couple" },
  { key: "kids_with_us",    label: "Kids with Us",     group: "family" },
  { key: "kids_activities", label: "Kids Activities",  group: "family" },
  { key: "family_notes",    label: "Family Notes",     group: "family" },
  { key: "kids_terms",      label: "Kids Term Dates",  group: "family" },
  { key: "ph",              label: "Public Holidays",  group: "family" },
];

const GROUP_BG: Record<"oliver" | "marieke" | "couple" | "family", string> = {
  oliver:  "bg-sky-100 dark:bg-sky-950/60",
  marieke: "bg-purple-100 dark:bg-purple-950/60",
  couple:  "bg-pink-100 dark:bg-pink-950/60",
  family:  "bg-emerald-100 dark:bg-emerald-950/60",
};
const GROUP_LABEL: Record<"oliver" | "marieke" | "couple" | "family", string> = {
  oliver:  "Oliver",
  marieke: "Marieke",
  couple:  "Marieke & Oliver",
  family:  "Family",
};

// ----------- Today/section classifier (simple 4-group) ---------------------
// Used by the Today section header chips. Mirrors the year-view groups.
type GroupKey = "oliver" | "marieke" | "couple" | "family";

function groupFor(summary: string): GroupKey | null {
  const col = columnFor(summary);
  if (!col) return null;
  const def = COL_DEFS.find((c) => c.key === col);
  return def ? def.group : null;
}

const GROUP_CHIP_BG: Record<GroupKey, string> = {
  oliver:  "bg-sky-200/60 dark:bg-sky-900/40",
  marieke: "bg-purple-200/60 dark:bg-purple-900/40",
  couple:  "bg-pink-200/60 dark:bg-pink-900/40",
  family:  "bg-emerald-200/60 dark:bg-emerald-900/40",
};

// --- Date helpers ------------------------------------------------------

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateOnly(s: string): Date {
  return new Date(s + "T00:00:00");
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtCellTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function eventsForDayKey(events: CalEvent[], dayKey: string): CalEvent[] {
  return events
    .filter((e) => {
      const startKey = dateKey(new Date(e.start));
      const endDt = e.allDay ? new Date(new Date(e.end).getTime() - 86400000) : new Date(e.end);
      const endKey = dateKey(endDt);
      return startKey <= dayKey && endKey >= dayKey;
    })
    .sort((a, b) => +new Date(a.start) - +new Date(b.start));
}

function summariseEventForCell(e: CalEvent): string {
  const sum = (e.summary || "").trim();
  const time = e.allDay ? "" : `${fmtCellTime(e.start)}\u2013${fmtCellTime(e.end)} `;
  // Strip leading [Category] prefixes (Oliver-All) and Hilde:/Axel: prefixes
  // (Kids Activities) so cell text isn't redundant with the column header.
  const stripped = sum
    .replace(/^\[(Elgin House|Sandringham|Peninsula Health|On-call|Travel|Medicolegal|Personal)\]\s*/, "")
    .replace(/^Hilde:\s*/i, "")
    .replace(/^Axel:\s*/i, "")
    .replace(/^Hilde\s*[\u2013\u2014-]\s*/i, "")
    .replace(/^Axel\s*[\u2013\u2014-]\s*/i, "")
    .replace(/^Marieke\s*[\u2013\u2014-]\s*/i, "")
    .replace(/^On-call\s*[\u2013\u2014-]\s*/i, "")
    .replace(/^Travel\s*[\u2013\u2014-]\s*/i, "")
    .replace(/^Medicolegal\s*[\u2013\u2014-]\s*/i, "");
  return `${time}${stripped}`.trim();
}

// --- Page --------------------------------------------------------------

export default function CalendarPlanner() {
  const [viewDate, setViewDate] = useState<Date>(new Date());
  const [drawerDate, setDrawerDate] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // Wide range so the rolling 12-month year view + kids-with-us detection works.
  const wideRange = useMemo(() => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const to = new Date(today.getFullYear() + 1, today.getMonth() + 2, 0);
    return { from: dateKey(from), to: dateKey(to) };
  }, []);

  const eventsQ = useQuery<{ events: CalEvent[] }>({
    queryKey: ["/api/planner/events", wideRange.from, wideRange.to],
    queryFn: async () => {
      const r = await apiRequest(
        "GET",
        `/api/planner/events?from=${wideRange.from}&to=${wideRange.to}`,
      );
      return r.json();
    },
  });

  const todayQ = useQuery<{ events: CalEvent[] }>({
    queryKey: ["/api/today-events"],
    refetchInterval: 60_000,
  });

  const notesQ = useQuery<{ notes: PlannerNote[] }>({
    queryKey: ["/api/planner/notes", wideRange.from, wideRange.to],
    queryFn: async () => {
      const r = await apiRequest(
        "GET",
        `/api/planner/notes?from=${wideRange.from}&to=${wideRange.to}`,
      );
      return r.json();
    },
  });

  const events = eventsQ.data?.events ?? [];
  const todayEvents = todayQ.data?.events ?? [];
  const notes = notesQ.data?.notes ?? [];
  const noteByDate = useMemo(() => new Map(notes.map((n) => [n.date, n])), [notes]);

  function navYear(delta: number) {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, d.getDate()));
  }
  function goToday() {
    setViewDate(new Date());
  }

  // Year window: rolling 12 months starting on Monday of the current week (relative to viewDate).
  // JS getDay(): Sun=0, Mon=1, ..., Sat=6. Offset to most recent Monday = ((day + 6) % 7).
  const _vd = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate());
  const _mondayOffset = (_vd.getDay() + 6) % 7;
  const yStart = addDays(_vd, -_mondayOffset);
  const yEnd = addDays(
    new Date(yStart.getFullYear() + 1, yStart.getMonth(), yStart.getDate()),
    -1,
  );

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 space-y-10">
      {/* ========== Header ========== */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Calendar / Planner</div>
          <h1 className="text-2xl font-semibold mt-1">Today and the year ahead</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Master feed plus rolling 12-month planner · Australia/Melbourne.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setExportOpen(true)}
          data-testid="button-export"
        >
          <Download className="h-4 w-4 mr-1" />
          Export Excel
        </Button>
      </header>

      {/* ========== Family Notes (today) ========== */}
      <FamilyNotesPanel date={todayDateStr()} />

      {/* ========== Today section ========== */}
      <TodaySection
        events={todayEvents.filter((e) => {
          // Only include events whose start date (Melbourne wall-clock) is today.
          const startKey = todayDateStr(new Date(e.start));
          return startKey === todayDateStr();
        })}
        loading={todayQ.isLoading}
        onPickDay={setDrawerDate}
      />

      {/* ========== Yearly planner ========== */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold">Yearly planner</h2>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => navYear(-1)}
              data-testid="button-nav-prev"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={goToday} data-testid="button-nav-today">
              Today
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => navYear(1)}
              data-testid="button-nav-next"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="text-sm font-medium text-muted-foreground ml-2">
              {yStart.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
              {" \u2013 "}
              {yEnd.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          </div>
        </div>

        {eventsQ.isLoading && (
          <div className="text-sm text-muted-foreground">Loading events…</div>
        )}

        <YearGroupedTable
          startDate={yStart}
          endDate={yEnd}
          events={events}
          notes={notes}
          onPickDay={setDrawerDate}
        />
      </section>

      {/* ========== Templates: Oliver / Marieke / Kids ========== */}
      <TemplateSections />

      <DayDrawer
        date={drawerDate}
        events={events}
        existingNote={drawerDate ? noteByDate.get(drawerDate)?.note ?? "" : ""}
        onClose={() => setDrawerDate(null)}
      />

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}

// --- Today section -------------------------------------------------------

function FamilyNotesPanel({ date }: { date: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const q = useQuery<{ notes: PlannerNote[] }>({
    queryKey: ["/api/planner/notes", date, date],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/planner/notes?from=${date}&to=${date}`);
      return r.json();
    },
  });

  const note = q.data?.notes?.[0]?.note ?? "";
  const lines = note.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);

  function startEdit() {
    setDraft(note);
    setEditing(true);
  }
  async function save() {
    await apiRequest("PUT", `/api/planner/notes/${date}`, { note: draft });
    queryClient.invalidateQueries({ queryKey: ["/api/planner/notes"] });
    setEditing(false);
  }

  return (
    <section className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-900 dark:text-emerald-200">
          Family Notes — Today
        </h2>
        {!editing ? (
          <Button size="sm" variant="ghost" onClick={startEdit} data-testid="button-edit-family-notes">
            {note ? "Edit" : "Add"}
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} data-testid="button-save-family-notes">
              Save
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder="e.g.\nOliver picks up kids 3.30pm\nMarieke cooks dinner"
          data-testid="textarea-family-notes"
        />
      ) : lines.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No notes for today. Add who's picking up the kids, who's cooking, anything else worth flagging.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-emerald-700 dark:text-emerald-400">·</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TodaySection({
  events,
  loading,
  onPickDay,
}: {
  events: CalEvent[];
  loading: boolean;
  onPickDay: (date: string) => void;
}) {
  const travelByUid = useTravelTodayMap(true);
  const grouped = useMemo(() => {
    const out = new Map<string, CalEvent[]>();
    for (const e of events) {
      const d = new Date(e.start);
      const key = todayDateStr(d);
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(e);
    }
    return out;
  }, [events]);

  const sortedKeys = Array.from(grouped.keys()).sort();
  const todayKey = todayDateStr();

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Today</h2>
        <span className="text-xs text-muted-foreground">From the merged Master ICS · refreshed every 60s.</span>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {!loading && sortedKeys.length === 0 && (
        <div className="text-sm text-muted-foreground italic rounded-lg border border-dashed p-6 text-center">
          No events today.
        </div>
      )}

      <div className="space-y-5">
        {sortedKeys.map((key) => {
          const dayEvents = grouped.get(key)!;
          const dt = new Date(key + "T00:00:00");
          const isToday = key === todayKey;
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => onPickDay(key)}
                className="text-xs uppercase tracking-wider text-muted-foreground mb-2 hover-elevate active-elevate-2 rounded px-1 py-0.5"
                data-testid={`today-day-${key}`}
              >
                {isToday ? "Today · " : ""}
                {dt.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
              </button>
              <div className="space-y-2">
                {dayEvents.map((e) => {
                  const grp = groupFor(e.summary);
                  const bg = grp ? GROUP_CHIP_BG[grp] : "bg-card";
                  return (
                    <div
                      key={e.uid + e.start}
                      className={cn(
                        "rounded-lg border p-3 grid grid-cols-[80px_1fr] gap-3",
                        bg,
                      )}
                      data-testid={`today-event-${e.uid}`}
                    >
                      <div className="text-sm tabular-nums text-muted-foreground">
                        {e.allDay ? "all-day" : (
                          <>
                            {fmtTimeShared(e.start)}
                            <div className="text-xs text-muted-foreground/70">{fmtTimeShared(e.end)}</div>
                          </>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{e.summary}</div>
                        {e.location && (
                          <div className="text-xs text-muted-foreground truncate">{e.location}</div>
                        )}
                        {(() => {
                          const tr = isToday ? travelByUid.get(e.uid) : undefined;
                          if (!tr) return null;
                          const lb = tr.allowMinutes != null ? leaveByLabel(e.start, tr.allowMinutes) : null;
                          return (
                            <div className="mt-1.5">
                              <TravelBadge travel={tr} showLeaveBy={lb} />
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- Year-grouped table --------------------------------------------------

function YearGroupedTable({
  startDate,
  endDate,
  events,
  notes,
  onPickDay,
}: {
  startDate: Date;
  endDate: Date;
  events: CalEvent[];
  notes: PlannerNote[];
  onPickDay: (date: string) => void;
}) {
  const todayKey = dateKey(new Date());
  const startKey = dateKey(startDate);
  const endKey = dateKey(endDate);

  const days = useMemo(() => {
    const out: Date[] = [];
    const cur = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const stop = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    while (cur.getTime() <= stop.getTime()) {
      out.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [startKey, endKey]);

  // Each cell holds a list of event entries with sort metadata so we can put
  // all-day events at the top, then chronological timed events. No truncation
  // ("+N more" removed) — every event is rendered, fully expanded.
  type CellEntry = { text: string; allDay: boolean; startMs: number };
  const grid = useMemo(() => {
    const map = new Map<string, Record<ColKey, CellEntry[]>>();
    for (const d of days) {
      const k = dateKey(d);
      const empty = Object.fromEntries(
        COL_DEFS.map((c) => [c.key, [] as CellEntry[]]),
      ) as Record<ColKey, CellEntry[]>;
      map.set(k, empty);
    }
    for (const e of events) {
      const col = columnFor(e.summary || "");
      if (!col) continue;
      const evStartKey = dateKey(new Date(e.start));
      const endDt = e.allDay ? new Date(new Date(e.end).getTime() - 86400000) : new Date(e.end);
      const evEndKey = dateKey(endDt);
      const cur = new Date(e.start);
      const startMs = +new Date(e.start);
      let safety = 0;
      while (dateKey(cur) <= evEndKey && safety++ < 400) {
        const k = dateKey(cur);
        if (k > endKey) break;
        const dayMap = map.get(k);
        if (dayMap && dayMap[col]) {
          dayMap[col].push({
            text: summariseEventForCell(e),
            allDay: !!e.allDay,
            startMs,
          });
        }
        cur.setDate(cur.getDate() + 1);
        if (evStartKey === evEndKey) break;
      }
    }
    // Inject Family Notes (one per date, multiline split). Treated as all-day.
    for (const n of notes) {
      const dayMap = map.get(n.date);
      if (!dayMap) continue;
      const lines = (n.note || "")
        .split(/\r?\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (!dayMap.family_notes) continue;
      for (const line of lines) {
        dayMap.family_notes.push({
          text: line,
          allDay: true,
          startMs: 0,
        });
      }
    }
    // Sort each cell: all-day first, then by start time.
    for (const dayMap of Array.from(map.values())) {
      for (const k of Object.keys(dayMap) as ColKey[]) {
        dayMap[k].sort((a: CellEntry, b: CellEntry) => {
          if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
          return a.startMs - b.startMs;
        });
      }
    }
    return map;
  }, [days, events, notes, endKey]);

  const groupSpans = useMemo(() => {
    const groups: Array<{ group: "oliver" | "marieke" | "couple" | "family"; span: number }> = [];
    for (const def of COL_DEFS) {
      const last = groups[groups.length - 1];
      if (last && last.group === def.group) last.span += 1;
      else groups.push({ group: def.group, span: 1 });
    }
    return groups;
  }, []);

  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 bg-card border-b border-r p-2 text-left font-semibold" colSpan={2}>
              {`${startDate.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} \u2013 ${endDate.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`}
            </th>
            {groupSpans.map((g, i) => (
              <th
                key={`${g.group}-${i}`}
                colSpan={g.span}
                className={cn(
                  "border-b border-r p-2 text-center font-semibold",
                  GROUP_BG[g.group],
                )}
              >
                {GROUP_LABEL[g.group]}
              </th>
            ))}
          </tr>
          <tr>
            <th className="sticky left-0 z-20 bg-card border-b border-r p-1.5 text-left font-medium w-16 min-w-[3.5rem]">Day</th>
            <th className="border-b border-r p-1.5 text-left font-medium w-20 min-w-[5rem]">Date</th>
            {COL_DEFS.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "border-b border-r p-1.5 text-center font-medium min-w-[8rem]",
                  GROUP_BG[c.group],
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const k = dateKey(d);
            const isToday = k === todayKey;
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            // Day: 3-letter abbreviation (Mon/Tue/Wed/Thu/Fri/Sat/Sun)
            const dayName = d.toLocaleDateString("en-AU", { weekday: "short" });
            // Date: dd/MM/yy (e.g. 07/05/26)
            const dd = String(d.getDate()).padStart(2, "0");
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const yy = String(d.getFullYear()).slice(-2);
            const dateLabel = `${dd}/${mm}/${yy}`;
            const cellMap = grid.get(k);
            return (
              <tr
                key={k}
                className={cn(
                  "border-b",
                  isToday && "ring-2 ring-primary ring-inset",
                  isWeekend && !isToday && "bg-muted/30",
                )}
              >
                <td
                  className={cn(
                    "sticky left-0 z-10 border-r p-1.5 align-top whitespace-nowrap cursor-pointer hover-elevate font-medium",
                    isWeekend ? "bg-muted/30" : "bg-card",
                  )}
                  onClick={() => onPickDay(k)}
                  data-testid={`year-row-${k}`}
                >
                  {dayName}
                </td>
                <td
                  className="border-r p-1.5 align-top whitespace-nowrap text-muted-foreground cursor-pointer hover-elevate"
                  onClick={() => onPickDay(k)}
                >
                  {dateLabel}
                </td>
                {COL_DEFS.map((c) => {
                  const entries = cellMap?.[c.key] ?? [];
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "border-r p-1.5 align-top text-[11px] leading-tight",
                        entries.length > 0 ? GROUP_BG[c.group] : "",
                      )}
                      onClick={() => onPickDay(k)}
                    >
                      {entries.length > 0 && (
                        <div className="space-y-0.5">
                          {entries.map((en, i) => (
                            <div
                              key={i}
                              className={cn(
                                "break-words",
                                en.allDay && "font-semibold",
                              )}
                              title={en.text}
                            >
                              {en.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Template sections (Oliver / Marieke / Kids) -------------------------

function TemplateSections() {
  const sections: Array<{
    title: string;
    group: GroupKey;
    items: Array<{ name: string; summary: string }>;
  }> = [
    {
      title: "Oliver — calendar templates",
      group: "oliver",
      items: [
        { name: "Oliver-All",      summary: "Combined feed: Elgin House, Sandringham, Peninsula Health, On-call, Travel, Medicolegal, Personal — events prefixed with [Category]." },
        { name: "Oliver-Work",     summary: "All paid clinical work (Elgin / Sandringham / Peninsula / Sandy roster)." },
        { name: "On-call.ics",     summary: "Sandringham + Alfred 24h shifts. Triggers couple-time skip on the day + the following morning." },
        { name: "Oliver-Travel",   summary: "Conferences, flights, hotels, annual leave, RDOs." },
        { name: "Medicolegal",     summary: "Independent medico-legal opinions / report deadlines / court dates." },
        { name: "Oliver-Personal", summary: "GP, dental, haircut, gym, podiatry, optometry, personal medical." },
      ],
    },
    {
      title: "Marieke — calendar templates",
      group: "marieke",
      items: [
        { name: "Marieke-Art",      summary: "Mondays 09:00–22:00 single block (continuous, includes travel time). AIR Wallan studio dates layer on top via Marieke-Studio." },
        { name: "Marieke-Studio",   summary: "AIR Wallan artist-in-residence sessions on discrete dates." },
        { name: "Marieke-Personal", summary: "Sourced ONLY from Marieke's iCloud feed — never from the build script. Read-only." },
        { name: "Marieke & Oliver", summary: "Friday date night, weekend kids-off blocks, Tea (10pm nightly), Marieke physio (10pm every alternate day from Mon 4 May 2026)." },
      ],
    },
    {
      title: "Kids — calendar templates",
      group: "family",
      items: [
        { name: "Kids-with-us",    summary: "Banner days when the kids are with us. Driven by 4-week NEW_FAMILY rotation (anchor Mon 25 May 2026), school-holiday 50:50 alternation (Term 1 2026 hols = Oliver-first), and recurring special days (Mother's/Father's Day, Daniel & Marieke birthdays)." },
        { name: "Kids-Activities", summary: "Combined Hilde + Axel activities, pre-fixed with 'Hilde:' / 'Axel:'. Sorted by start." },
        { name: "Kids-Term-Dates", summary: "School term + holiday banners for both schools (Hilde @ NMPS, Axel @ UHS)." },
        { name: "Public Holidays", summary: "Victorian public holidays, plus Mother's Day, Father's Day, family birthdays." },
      ],
    },
  ];

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Calendar templates &amp; rules</h2>
      <p className="text-sm text-muted-foreground">
        Reference for what each feed contains and how events are routed into the year-view columns above.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {sections.map((s) => (
          <div
            key={s.title}
            className={cn(
              "rounded-lg border p-4 space-y-3",
              GROUP_BG[s.group],
            )}
          >
            <div className="text-sm font-semibold">{s.title}</div>
            <ul className="space-y-2 text-xs">
              {s.items.map((item) => (
                <li key={item.name}>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-muted-foreground leading-snug">{item.summary}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Day drawer ----------------------------------------------------------

function DayDrawer({
  date,
  events,
  existingNote,
  onClose,
}: {
  date: string | null;
  events: CalEvent[];
  existingNote: string;
  onClose: () => void;
}) {
  const isTodayDrawer = date === todayDateStr();
  const travelByUid = useTravelTodayMap(isTodayDrawer);
  const [note, setNote] = useState(existingNote);
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    setNote(existingNote);
    setSaveState("idle");
  }, [date, existingNote]);

  async function save(text: string) {
    if (!date) return;
    setSaveState("saving");
    try {
      await apiRequest("PUT", `/api/planner/notes/${date}`, { note: text });
      setSaveState("saved");
      queryClient.invalidateQueries({ queryKey: ["/api/planner/notes"] });
    } catch (err) {
      console.error(err);
      setSaveState("idle");
    }
  }

  function onChange(v: string) {
    setNote(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void save(v);
    }, 800);
  }

  function onBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (note !== existingNote) void save(note);
  }

  const dayEvents = date ? eventsForDayKey(events, date) : [];
  const dt = date ? parseDateOnly(date) : null;

  return (
    <Drawer open={!!date} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-2xl">
          <DrawerHeader>
            <DrawerTitle>
              {dt
                ? dt.toLocaleDateString("en-AU", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : ""}
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-2 space-y-4">
            <section>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Events
              </div>
              {dayEvents.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">No events.</div>
              ) : (
                <div className="space-y-1.5">
                  {dayEvents.map((e) => (
                    <div
                      key={e.uid + e.start}
                      className="rounded-md border bg-card p-2 grid grid-cols-[80px_1fr] gap-3"
                    >
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {e.allDay ? "all-day" : (
                          <>
                            <div>{fmtTimeShared(e.start)}</div>
                            <div className="text-muted-foreground/60">{fmtTimeShared(e.end)}</div>
                          </>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{e.summary}</div>
                        {e.location && (
                          <div className="text-xs text-muted-foreground truncate">
                            {e.location}
                          </div>
                        )}
                        {(() => {
                          const tr = isTodayDrawer ? travelByUid.get(e.uid) : undefined;
                          if (!tr) return null;
                          const lb = tr.allowMinutes != null ? leaveByLabel(e.start, tr.allowMinutes) : null;
                          return (
                            <div className="mt-1.5">
                              <TravelBadge travel={tr} showLeaveBy={lb} />
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Notes
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {saveState === "saving" && "Saving…"}
                  {saveState === "saved" && "Saved"}
                </div>
              </div>
              <Textarea
                value={note}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onBlur}
                placeholder="Notes for this day…"
                rows={6}
                data-testid="planner-day-note"
              />
            </section>
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" data-testid="button-close-drawer">
                Close
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// --- Excel export dialog -------------------------------------------------

function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const todayStr = dateKey(new Date());
  const yearOutStr = dateKey(addDays(new Date(), 365));
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(yearOutStr);

  function submit() {
    const params = new URLSearchParams({ from, to });
    let token: string | null = null;
    try {
      token =
        localStorage.getItem("buoy_token") ||
        localStorage.getItem("anchor_token");
    } catch {}
    if (token) params.set("t", token);
    // Stage 14b: build the export URL against the current page origin
    // explicitly. The legacy `__PORT_5000__` placeholder dance produced a
    // relative path that, under hash routing, the browser occasionally
    // resolved against the wrong base (e.g. proxy 404s on some setups).
    // location.origin is always the canonical site origin and survives
    // hash routing untouched.
    const origin =
      typeof window !== "undefined" && window.location
        ? window.location.origin
        : "";
    const url = `${origin}/api/planner/export?${params.toString()}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `buoy-planner-${from}-to-${to}.xlsx`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export planner</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="exp-from">From</Label>
            <Input
              id="exp-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="export-from"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-to">To</Label>
            <Input
              id="exp-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="export-to"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} data-testid="button-export-submit">
            <Download className="h-4 w-4 mr-1" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
