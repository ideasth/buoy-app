// Feature 1 — Compact "allow N min · Maps" badge for calendar events.
// Click the Maps icon to open Google Maps directions in a new tab.

import { MapPin, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TravelMatchPayload } from "@/lib/travel";

interface Props {
  travel: TravelMatchPayload | null | undefined;
  className?: string;
  /** When true, render an extended pill that includes "Leave by HH:MM". */
  showLeaveBy?: string | null;
}

export function TravelBadge({ travel, className, showLeaveBy }: Props) {
  if (!travel || !travel.matchedLocation || travel.allowMinutes == null) {
    return null;
  }
  const allow = travel.allowMinutes;
  const url = travel.outboundMapsUrl;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium tabular-nums",
        className,
      )}
      data-testid="travel-badge"
      title={
        travel.matchedLocation.name +
        (travel.nominalMinutes != null ? ` · drive ~${travel.nominalMinutes}m` : "") +
        (travel.matchedKeyword ? ` · matched "${travel.matchedKeyword}"` : "")
      }
    >
      <MapPin className="h-3 w-3 text-muted-foreground" />
      <span className="text-muted-foreground">Allow {allow}m</span>
      {showLeaveBy && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-foreground">Leave {showLeaveBy}</span>
        </>
      )}
      {url && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
            data-testid="travel-maps-link"
            onClick={(e) => e.stopPropagation()}
          >
            Maps
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </>
      )}
    </span>
  );
}
