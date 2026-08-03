#!/usr/bin/env python3
"""Parse anchor/client/src/generated/master-template.json into per-owner
4-week rotation dicts consumable by build_calendars.py.

Output structure for each owner ("ElginHouse", "Sandringham", "Peninsula",
"Family"):
    {"anchor": date(YYYY,M,D),
     "weeks": [[(am,pm)*days]*4]}   # 5 days Mon–Fri for work owners,
                                     # 7 days Mon–Sun for Family (raw kids strings)

The Family entry retains the raw kids-column strings ("Kids with us",
"Kids handover 0900", "Kids handover 1500", "") so the ICS builder can turn
them into timed handover events or all-day "Kids with us" markers.

This is the ONLY parser of the roster template. build_calendars.py must
import from here — no duplicate hardcoded rotations anywhere. Source of
truth = anchor/client/public/MasterTemplateCalendar.xlsx.
"""
from __future__ import annotations
import json, re, sys
from datetime import date
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
TPL_PATH = REPO_ROOT / "client" / "src" / "generated" / "master-template.json"

DAYS_KEYS = ["mon","tue","wed","thu","fri","sat","sun"]


def _owner_of(label: str) -> Optional[str]:
    if not label:
        return None
    s = label.strip()
    if re.match(r"^PH\s*:", s, re.IGNORECASE):
        return "Peninsula"
    if re.match(r"^SH\s*:", s, re.IGNORECASE):
        return "Sandringham"
    if re.match(r"^(Elgin House|Braybrook|Carlton)\b", s, re.IGNORECASE):
        return "ElginHouse"
    return None


def _strip_prefix(label: str) -> str:
    return re.sub(r"^(PH|SH)\s*:\s*", "", label, flags=re.IGNORECASE).strip()


def _slot_of(text: str) -> tuple[str, Optional[str]]:
    """Return (body, slot) where slot is 'AM'/'PM'/None."""
    m = re.match(r"^(.*?)\s*\((AM|PM)\)\s*$", text.strip(), re.IGNORECASE)
    if m:
        return (m.group(1).strip(), m.group(2).upper())
    return (text.strip(), None)


def _split_segments(raw: str) -> list[tuple[str, str]]:
    """Split a raw day roster string into (owner, body_with_slot) segments.

    Handles:
      - '/' delimiter between segments
      - newline continuation (implicit owner inheritance from previous segment
        unless the continuation line itself starts a new owner)
      - accidental duplicated prefix ('PH: PH: ADMIN' -> 'PH: ADMIN')
      - defaults to ElginHouse if a segment has no explicit owner and no
        previous owner is in scope
    """
    if not raw:
        return []
    text = raw
    # Normalise accidental duplicated prefixes.
    text = re.sub(r"(PH|SH)\s*:\s*\1\s*:", r"\1:", text, flags=re.IGNORECASE)

    # First split on newlines (newline = new "line" of the day, but the owner
    # from the previous line carries over to the next line's first segment
    # unless the next segment declares its own owner).
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]

    segments: list[tuple[str, str]] = []
    last_owner: Optional[str] = None

    for line in lines:
        # Within a line, split on ' / '.
        parts = [p.strip() for p in re.split(r"\s*/\s*", line) if p.strip()]
        line_owner = _owner_of(parts[0]) if parts else None
        # Owner scope for this line: explicit prefix on the first part
        # takes over. Otherwise inherit last_owner.
        scope_owner = line_owner or last_owner
        for p in parts:
            po = _owner_of(p)
            if po:
                scope_owner = po
            if scope_owner is None:
                scope_owner = "ElginHouse"  # last-resort default
            segments.append((scope_owner, p))
            last_owner = scope_owner
    return segments


def _apply_segment(owner_weeks: dict[str, list[tuple[Optional[str], Optional[str]]]],
                    owner: str, body: str) -> None:
    """Mutate owner_weeks[owner] (a list [(am,pm)] indexed 0..) — no, this
    helper is called per single day; caller manages indexing."""
    raise NotImplementedError  # placeholder — see parse_day_roster


def parse_day_roster(raw: str) -> dict[str, tuple[Optional[str], Optional[str]]]:
    """Return {owner: (am, pm)}. AM/PM labels have their prefix stripped.
    If a segment has no slot marker it's treated as all-day (both halves)."""
    out: dict[str, tuple[Optional[str], Optional[str]]] = {}
    for owner, seg in _split_segments(raw):
        body, slot = _slot_of(seg)
        clean = _strip_prefix(body)
        if not clean:
            continue
        am, pm = out.get(owner, (None, None))
        if slot == "AM":
            am = (am + " / " + clean) if am else clean
        elif slot == "PM":
            pm = (pm + " / " + clean) if pm else clean
        else:
            # No slot marker -> all-day
            am = (am + " / " + clean) if am else clean
            pm = (pm + " / " + clean) if pm else clean
        out[owner] = (am, pm)
    return out


def load() -> dict:
    """Return {"anchor": date, "ElginHouse": {...}, "Sandringham": {...},
    "Peninsula": {...}, "Family": {...}} — Family carries raw kids strings."""
    tpl = json.loads(TPL_PATH.read_text(encoding="utf-8"))
    anchor = date.fromisoformat(tpl["anchorDateIso"])

    owners_work = ["ElginHouse","Sandringham","Peninsula"]
    out: dict = {"anchor": anchor, "sourceSha256": tpl.get("fileSha256")}
    for o in owners_work:
        out[o] = {"anchor": anchor, "weeks": []}
    out["Family"] = {"anchor": anchor, "weeks": []}

    for w in tpl["weeks"]:
        week_by_owner: dict[str, list[tuple[Optional[str], Optional[str]]]] = {o: [] for o in owners_work}
        kids_week: list[str] = []
        for dkey in DAYS_KEYS:
            day = w["days"].get(dkey, {}) or {}
            parsed = parse_day_roster(day.get("roster", "") or "")
            for o in owners_work:
                week_by_owner[o].append(parsed.get(o, (None, None)))
            kids_week.append((day.get("kids", "") or "").strip())
        for o in owners_work:
            # Work calendars are Mon–Fri only.
            out[o]["weeks"].append(week_by_owner[o][:5])
        out["Family"]["weeks"].append(kids_week)  # full 7 days as raw strings

    return out


if __name__ == "__main__":
    data = load()
    print(f"anchor: {data['anchor']}  sha256: {data['sourceSha256'][:12]}…")
    for owner in ["ElginHouse","Sandringham","Peninsula"]:
        print(f"\n=== {owner} ===")
        for i, wk in enumerate(data[owner]["weeks"], 1):
            print(f"  Wk{i}: {wk}")
    print("\n=== Family (raw kids strings) ===")
    for i, wk in enumerate(data["Family"]["weeks"], 1):
        print(f"  Wk{i}: {wk}")
