// Hard-coded mapping of Microsoft To Do list names → Anchor domain.
// Used by the importer and the live sync engine.

export type AnchorDomain = "family" | "work" | "medicolegal" | "personal" | "health";

const FAMILY: ReadonlySet<string> = new Set([
  "Home-Family",
  "From Marieke",
  "Personal tasks",
]);

const PERSONAL: ReadonlySet<string> = new Set([
  "Tasks (default)",
  "Inbox_Braindump",
  "Today's Commitments",
  "Active",
  "Waiting",
  "Someday/Parked",
  "Life-Organisation-Planning-TimeManagement",
  "Academic-UniMelb",
  "Untitled list 1",
]);

// Substring patterns → medicolegal
const MEDICOLEGAL_PATTERNS = [
  /Medicolegal/i,
  /KLG-/i,
  /Law reform/i,
  /Experian credentialing/i,
];

export function mapListNameToDomain(name: string): AnchorDomain {
  if (FAMILY.has(name)) return "family";
  if (PERSONAL.has(name)) return "personal";
  for (const pat of MEDICOLEGAL_PATTERNS) {
    if (pat.test(name)) return "medicolegal";
  }
  return "work";
}
