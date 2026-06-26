// Templates page — renders MasterTemplateCalendar.xlsx (parsed at build time
// by scripts/build-master-template.cjs into client/src/generated/master-template.json).
//
// Update flow: replace client/public/MasterTemplateCalendar.xlsx in the repo,
// push, redeploy (npm run build runs the parser; the JSON is regenerated).
// See CONTEXT.md "Master Rotation Template" for the standing rule.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type {
  DayKey,
  MasterTemplate,
  RotationWeek,
} from "@/types/master-template";
import templateRaw from "@/generated/master-template.json";

const template = templateRaw as MasterTemplate;

const DAY_LABELS: Array<{ key: DayKey; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

// SharePoint source URLs (parent folder + this specific file). Mirrored in
// CONTEXT.md and the Space Instructions paste so all three stay in sync.
const SHAREPOINT_FOLDER_URL =
  "https://aupfhs-my.sharepoint.com/:f:/g/personal/drjoliverdaly_aupfhs_com_au/IgBQIUUwd5ivSakAQd_oRq6OAeLXJTy55yfqKIb_pi-3iXY?e=5UmRLd";
const SHAREPOINT_FILE_URL =
  "https://aupfhs-my.sharepoint.com/personal/drjoliverdaly_aupfhs_com_au/Documents/Personal/Life-Organisation-Planning-TimeManagement/LifeManagementTemplates/MasterTemplateCalendar.xlsx";

function formatDateAu(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTimeAu(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function Templates() {
  const weeks = template.weeks;
  const linksBySection = useMemo(() => groupLinks(template.workLinks), []);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px]">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="text-sm text-muted-foreground">
          Reference materials parsed from{" "}
          <span className="font-mono">{template.sourceFilename}</span>. Updates
          flow: replace the file in <span className="font-mono">client/public/</span>{" "}
          and redeploy.
        </p>
      </header>

      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-lg font-semibold">Master Rotation Template</h2>
        <p className="text-sm">{template.title}</p>
        <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[max-content_1fr]">
          <dt>Sheet</dt>
          <dd className="font-mono">{template.sheetName}</dd>
          <dt>Key</dt>
          <dd>{template.keyDescription}</dd>
          <dt>Anchor (SH Wk 1)</dt>
          <dd>{formatDateAu(template.anchorDateIso)}</dd>
          <dt>Last revision</dt>
          <dd>{formatDateAu(template.lastRevisionIso)}</dd>
          <dt>File last modified</dt>
          <dd>{formatDateTimeAu(template.fileMtimeIso)}</dd>
          <dt>File size</dt>
          <dd>{template.fileSizeBytes.toLocaleString("en-AU")} bytes</dd>
          <dt>SHA-256</dt>
          <dd className="font-mono break-all">{template.fileSha256}</dd>
        </dl>

        <div className="flex flex-wrap gap-2 text-sm pt-2">
          <a
            href="/MasterTemplateCalendar.xlsx"
            className="rounded-md border px-3 py-1.5 hover-elevate active-elevate-2"
            data-testid="link-download-master-template"
            download
          >
            Download .xlsx
          </a>
          <a
            href={SHAREPOINT_FILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border px-3 py-1.5 hover-elevate active-elevate-2"
            data-testid="link-sharepoint-file"
          >
            Open in SharePoint
          </a>
          <a
            href={SHAREPOINT_FOLDER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border px-3 py-1.5 hover-elevate active-elevate-2"
            data-testid="link-sharepoint-folder"
          >
            LifeManagementTemplates folder
          </a>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="text-lg font-semibold">4-week rotation cycle</h2>
          <p className="text-xs text-muted-foreground">
            Anchor Monday: {formatDateAu(template.anchorDateIso)}. Repeats every{" "}
            {weeks.length} weeks indefinitely.
          </p>
        </div>

        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="border-b border-r p-2 text-left font-semibold w-24 min-w-[6rem]">
                  Week
                </th>
                <th className="border-b border-r p-2 text-left font-semibold w-28 min-w-[7rem]">
                  Week numbers
                </th>
                {DAY_LABELS.map((d) => (
                  <th
                    key={d.key}
                    className="border-b border-r p-2 text-center font-semibold min-w-[8rem]"
                  >
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <WeekRow key={w.index} week={w} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Work links</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {linksBySection.map(({ section, items }) => (
            <div key={section} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="text-sm font-semibold">{section}</div>
              <ul className="space-y-1.5 text-sm">
                {items.map((item, i) => (
                  <li key={`${item.label}-${i}`}>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline break-words"
                        data-testid={`link-work-${i}`}
                      >
                        {item.label}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{item.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {template.notes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Notes</h2>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            {template.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[11px] text-muted-foreground pt-4 border-t">
        Generated {formatDateTimeAu(template.generatedAtIso)} from{" "}
        <span className="font-mono">{template.sourceFilename}</span> (SHA-256{" "}
        <span className="font-mono">{template.fileSha256.slice(0, 12)}…</span>).
      </p>
    </div>
  );
}

function WeekRow({ week }: { week: RotationWeek }) {
  return (
    <tr className="border-b align-top">
      <td className="border-r p-2 font-semibold whitespace-nowrap">
        Week {week.index}
        <div className="text-[10px] font-normal text-muted-foreground">
          from {formatDateAu(week.weekStartIso)}
        </div>
      </td>
      <td className="border-r p-2 whitespace-nowrap text-[11px] leading-snug">
        <div>EH {fmt(week.ehWeek)}</div>
        <div>SH {fmt(week.shWeek)}</div>
        <div>PH {fmt(week.phWeek)}</div>
        <div>Kids {fmt(week.kidsWeek)}</div>
      </td>
      {DAY_LABELS.map((d) => {
        const day = week.days[d.key];
        return (
          <td key={d.key} className="border-r p-2 text-[11px] leading-snug align-top">
            {day.roster && (
              <div className="font-medium whitespace-pre-line">{day.roster}</div>
            )}
            {day.kids && (
              <div
                className={cn(
                  "text-muted-foreground whitespace-pre-line",
                  day.roster && "mt-1",
                )}
              >
                {day.kids}
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function fmt(n: number | null): string {
  return n == null ? "—" : String(n);
}

function groupLinks(links: MasterTemplate["workLinks"]) {
  const order: string[] = [];
  const map = new Map<string, MasterTemplate["workLinks"]>();
  for (const link of links) {
    if (!map.has(link.section)) {
      map.set(link.section, []);
      order.push(link.section);
    }
    map.get(link.section)!.push(link);
  }
  return order.map((section) => ({ section, items: map.get(section)! }));
}
