// QuickCaptureModal — true one-tap capture without leaving the current page.
//
// Hotkey-friendly: Enter saves, Shift+Enter inserts a newline, Esc closes.
// Auto-focuses the textarea on open and clears on close. Domain is
// auto-classified from the title (same heuristic as the full Capture page),
// estimate defaults to 30m, status defaults to "todo". For full control
// (voice input, manual estimate, manual domain override) the user can still
// open the full /capture page.

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { classifyTask } from "@/lib/anchor";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickCaptureModal({ open, onOpenChange }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Focus the textarea every time the modal opens, and clear stale text from
  // a previous open so it always starts fresh.
  useEffect(() => {
    if (open) {
      setTitle("");
      // setTimeout 0 to wait for Radix to mount the focusable element.
      const t = window.setTimeout(() => ref.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const submit = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      const cls = classifyTask(t);
      await apiRequest("POST", "/api/tasks", {
        title: t,
        domain: cls.domain,
        priority: cls.priority ?? "iftime",
        estimateMinutes: 30,
        status: "todo",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Captured", description: t.slice(0, 60) });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Save failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter saves; Shift+Enter inserts newline (default behaviour).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    // Esc is handled by Radix Dialog automatically.
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-quick-capture">
        <DialogHeader>
          <DialogTitle>Quick capture</DialogTitle>
          <DialogDescription>
            Title only. Enter to save, Esc to close. Domain auto-classified;
            30 min default. Use the full Capture page for finer control.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          ref={ref}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKey}
          placeholder="What just came up?"
          rows={3}
          data-testid="textarea-quick-capture"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {title.trim() ? `${title.trim().length} chars` : "Type and press Enter"}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-quick-capture-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={!title.trim() || saving}
              data-testid="button-quick-capture-save"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
