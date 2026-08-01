// AddEventDialog — CalendarPlanner "Add event" affordance.
//
// Two entry modes:
//   1. Pickers — category dropdown, title, all-day toggle, start/end Melbourne
//                wall-clock, location, notes.
//   2. Paste  — free-text natural language ("Coffee with Sam next Thurs 3pm at
//                Higher Ground"). Sent to POST /api/events/parse which uses
//                the baked Perplexity Sonar key. Result populates the picker
//                fields for the user to confirm before saving.
//
// Modes share the same underlying form state. Saving POSTs /api/events with
// the four required fields; server enforces validation and category enum.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";

type Category = "oliver_work" | "oliver_personal" | "family";

const CATEGORY_LABEL: Record<Category, string> = {
  oliver_work: "Oliver — Work",
  oliver_personal: "Oliver — Personal",
  family: "Family",
};

// Convert a Melbourne wall-clock "YYYY-MM-DDTHH:mm" string to a UTC ISO. The
// browser's runtime timezone is trustworthy for its own user, so we build a
// Date in local time then read toISOString(). This assumes the user's device
// clock is set to Melbourne (or a timezone with the same offset as Melbourne
// on the chosen date), which is true for Oliver on his primary devices.
function melbourneLocalToUtc(local: string, allDay: boolean): string {
  if (!local) return "";
  if (allDay) {
    // Store as floating midnight in UTC (matches how build_calendars.py emits
    // DATE-valued VEVENT DTSTART).
    return new Date(local + "T00:00:00Z").toISOString();
  }
  // Interpret the local wall-clock in the browser's timezone (which is
  // Australia/Melbourne on Oliver's devices).
  const d = new Date(local);
  return d.toISOString();
}

function utcIsoToMelbourneLocalInput(iso: string, allDay: boolean): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (allDay) {
    // For all-day, read the UTC calendar date directly.
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  // Show the browser's local wall-clock (Melbourne on Oliver's devices).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

// Default: 09:00 today (Melbourne) for 1 hour.
function defaultStartLocal(): string {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T09:00`;
}
function addOneHour(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  d.setHours(d.getHours() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export interface AddEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Optional edit context — when present, dialog opens in edit mode and PATCHes on save.
  editingId?: number | null;
  initial?: {
    category: Category;
    title: string;
    start_utc: string;
    end_utc: string;
    all_day: boolean;
    location: string;
    notes: string;
  } | null;
}

export function AddEventDialog({
  open,
  onOpenChange,
  editingId,
  initial,
}: AddEventDialogProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!editingId;

  const [mode, setMode] = useState<"pickers" | "paste">("pickers");
  const [category, setCategory] = useState<Category>("oliver_work");
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startLocal, setStartLocal] = useState(defaultStartLocal());
  const [endLocal, setEndLocal] = useState(addOneHour(defaultStartLocal()));
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);

  // Reset when opened.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setCategory(initial.category);
      setTitle(initial.title);
      setAllDay(initial.all_day);
      setStartLocal(utcIsoToMelbourneLocalInput(initial.start_utc, initial.all_day));
      setEndLocal(utcIsoToMelbourneLocalInput(initial.end_utc, initial.all_day));
      setLocation(initial.location);
      setNotes(initial.notes);
      setMode("pickers");
    } else {
      setCategory("oliver_work");
      setTitle("");
      setAllDay(false);
      const s = defaultStartLocal();
      setStartLocal(s);
      setEndLocal(addOneHour(s));
      setLocation("");
      setNotes("");
      setMode("pickers");
    }
    setPasteText("");
    setParseWarnings([]);
    setParsing(false);
    setSaving(false);
  }, [open, initial]);

  // When start changes, if end < start snap end to start + 1h.
  useEffect(() => {
    if (!startLocal || !endLocal) return;
    if (allDay) return;
    if (new Date(endLocal) <= new Date(startLocal)) {
      setEndLocal(addOneHour(startLocal));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startLocal, allDay]);

  async function runParse() {
    if (!pasteText.trim()) return;
    setParsing(true);
    setParseWarnings([]);
    try {
      const r = await apiRequest("POST", "/api/events/parse", {
        text: pasteText.trim(),
        referenceDate: new Date().toISOString(),
      });
      const data = await r.json();
      if (!r.ok) {
        toast({
          title: "Couldn't parse that",
          description: data.error || "Try rephrasing or use the pickers.",
          variant: "destructive",
        });
        return;
      }
      setTitle(data.title || "");
      setAllDay(!!data.all_day);
      setStartLocal(utcIsoToMelbourneLocalInput(data.start_utc, !!data.all_day));
      setEndLocal(utcIsoToMelbourneLocalInput(data.end_utc, !!data.all_day));
      setLocation(data.location || "");
      setNotes(data.notes || "");
      setParseWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setMode("pickers");
      if (data.confidence === "low") {
        toast({
          title: "Low confidence parse",
          description: "Please check the fields before saving.",
        });
      }
    } catch (err: any) {
      toast({
        title: "Parse request failed",
        description: String(err?.message ?? err),
        variant: "destructive",
      });
    } finally {
      setParsing(false);
    }
  }

  async function save() {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    if (!startLocal || !endLocal) {
      toast({ title: "Start and end required", variant: "destructive" });
      return;
    }
    const body = {
      category,
      title: title.trim(),
      start_utc: melbourneLocalToUtc(startLocal, allDay),
      end_utc: melbourneLocalToUtc(
        allDay ? endLocal : endLocal,
        allDay,
      ),
      all_day: allDay,
      location: location.trim() || null,
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      const url = isEdit ? `/api/events/${editingId}` : "/api/events";
      const method = isEdit ? "PATCH" : "POST";
      const r = await apiRequest(method, url, body);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast({
          title: isEdit ? "Update failed" : "Save failed",
          description: err.error || `HTTP ${r.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: isEdit ? "Event updated" : "Event added",
        description: `${CATEGORY_LABEL[category]} — ${title.trim()}`,
      });
      qc.invalidateQueries({ queryKey: ["/api/planner/events"] });
      qc.invalidateQueries({ queryKey: ["/api/today-events"] });
      qc.invalidateQueries({ queryKey: ["/api/events"] });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Network error",
        description: String(err?.message ?? err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const startInputType = allDay ? "date" : "datetime-local";
  const endInputType = allDay ? "date" : "datetime-local";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="add-event-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit event" : "Add event"}</DialogTitle>
        </DialogHeader>

        {!isEdit && (
          <div className="flex gap-1 border rounded-md p-1 bg-muted/30">
            <button
              type="button"
              className={
                "flex-1 text-xs py-1 rounded " +
                (mode === "pickers"
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground")
              }
              onClick={() => setMode("pickers")}
            >
              Pickers
            </button>
            <button
              type="button"
              className={
                "flex-1 text-xs py-1 rounded flex items-center justify-center gap-1 " +
                (mode === "paste"
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground")
              }
              onClick={() => setMode("paste")}
            >
              <Sparkles className="h-3 w-3" />
              Paste free text
            </button>
          </div>
        )}

        {mode === "paste" && !isEdit ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="paste-text">
                Describe the event in your own words
              </Label>
              <Textarea
                id="paste-text"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="e.g. Coffee with Sam next Thursday 3pm at Higher Ground for 30 min"
                rows={4}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Parsed with Perplexity Sonar. You'll confirm the fields before
                saving.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={runParse}
                disabled={parsing || !pasteText.trim()}
                data-testid="button-parse-event"
              >
                {parsing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Parsing…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1" />
                    Parse
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {parseWarnings.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                <div className="font-medium mb-1">Assumptions made:</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {parseWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <Label htmlFor="category">Calendar</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as Category)}
              >
                <SelectTrigger id="category" data-testid="select-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oliver_work">Oliver — Work</SelectItem>
                  <SelectItem value="oliver_personal">Oliver — Personal</SelectItem>
                  <SelectItem value="family">Family</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Coffee with Sam"
                maxLength={200}
                data-testid="input-title"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="all-day">All day</Label>
              <Switch
                id="all-day"
                checked={allDay}
                onCheckedChange={setAllDay}
                data-testid="switch-all-day"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="start">Start (Melbourne)</Label>
                <Input
                  id="start"
                  type={startInputType}
                  value={
                    allDay
                      ? startLocal.slice(0, 10)
                      : startLocal
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    setStartLocal(allDay ? v : v);
                  }}
                  data-testid="input-start"
                />
              </div>
              <div>
                <Label htmlFor="end">End (Melbourne)</Label>
                <Input
                  id="end"
                  type={endInputType}
                  value={
                    allDay
                      ? endLocal.slice(0, 10)
                      : endLocal
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    setEndLocal(allDay ? v : v);
                  }}
                  data-testid="input-end"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Optional"
                maxLength={300}
                data-testid="input-location"
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                rows={2}
                maxLength={2000}
                data-testid="input-notes"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || mode === "paste"}
            data-testid="button-save-event"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Saving…
              </>
            ) : isEdit ? (
              "Update event"
            ) : (
              "Save event"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
