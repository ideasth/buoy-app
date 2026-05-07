import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const PRESETS = [5, 10, 15, 20, 30];

export function LateModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [mins, setMins] = useState(10);
  const { toast } = useToast();

  const message = `Running ${mins} min late — apologies, on my way.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast({ title: "Copied", description: "Message copied to clipboard." });
      onOpenChange(false);
    } catch {
      toast({ title: "Copy failed", description: message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Running late</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => setMins(m)}
                data-testid={`button-late-${m}`}
                className={`px-3 py-1.5 rounded-md text-sm border ${
                  m === mins
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-secondary-foreground border-border hover-elevate"
                }`}
              >
                {m} min
              </button>
            ))}
          </div>
          <div className="rounded-md border bg-muted/40 p-3 text-sm font-mono">{message}</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              asChild
              variant="outline"
              className="flex-1"
              data-testid="button-late-sms"
            >
              <a href={`sms:?body=${encodeURIComponent(message)}`}>Open SMS</a>
            </Button>
            <Button
              asChild
              variant="outline"
              className="flex-1"
              data-testid="button-late-email"
            >
              <a href={`mailto:?subject=${encodeURIComponent("Running late")}&body=${encodeURIComponent(message)}`}>
                Open Email
              </a>
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={copy} className="w-full" data-testid="button-late-copy">
            Copy message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
