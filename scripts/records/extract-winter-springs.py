"""
Extract roofing permit records from Winter Springs PDFs into one combined CSV
(data/inbox/winter-springs/combined-permits.csv) for the file-adapter ingest.

New World files (2000-2024): ROOF-ONLY listings (every page shows "Type: ROOF").
Energov file (2023-2026):    "Roof Permits" report, but includes Solar/Sign/Shed
                             rows — DESCRIPTION column feeds the ingest roof_filter.
"""

import bisect
import csv
import os
import re

import pdfplumber

BASE_DIR = os.path.join(os.path.dirname(__file__), "..", "..")
INBOX = os.path.join(BASE_DIR, "data", "inbox", "winter-springs")
OUTPUT_CSV = os.path.join(INBOX, "combined-permits.csv")

NEW_WORLD_PDFS = [
    "2026-06-10-New_World_Permit_Listing_-_Jan_1_2000_-_Dec_31_2004.pdf",
    "2026-06-10-New_World_Permit_Listing_-_Jan_1_2005_-_Jan_1_2015.pdf",
    "2026-06-10-New_World_Permit_Listing_-_Jan_2_2015_-_2024.pdf",
]
ENERGOV_PDF = "2026-06-10-Roof_Permits_-_Energov_2023_-_04_21_2026.pdf"

CSV_HEADERS = ["PERMIT_NUMBER", "PARCEL_NUMBER", "ADDRESS", "ISSUE_DATE", "STATUS", "DESCRIPTION"]


# ---------------------------------------------------------------------------
# New World helpers
# ---------------------------------------------------------------------------
# Column X thresholds (from visual analysis):
#   x < 130       : permit number / date / "Estimated Value" marker
#   130 <= x < 230: status words ("Permit Expired", "Permit Completed", etc.)
#   230 <= x < 350: owner / contractor names
#   350 <= x < 500: parcel number (on permit row) OR street address (on date row)
#   x >= 550       : dollar amounts / description overflow
#
# Record layout (3-4 rows per permit):
#   Row A  (optional): contractor name spilling into city column
#   Row B  (permit): permit_number  |  "Permit" + status_word  |  parcel_number
#   Row C  (date):   issue_date     |                           |  street_number + street_name
#   Row D  (city):   "WINTER SPRINGS, FL ZIP"                  (+ optional description overflow)
#   Row E  (extra):  "Estimated Value: ..."                    (delimiter row)


_PERMIT_RE = re.compile(r"^\d{5,}$|^\d{4}-\d{5,}$")     # 200403555 or 2014-00000643
_DATE_RE = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")       # MM/DD/YYYY
_EST_VALUE_RE = re.compile(r"^Estimated$")               # permit-record delimiter row


_TIME_RE = re.compile(r"^\d{1,2}:\d{2}")                 # footer timestamp fragment
_PAGE_FURNITURE = {"AM", "PM", "Location/Lot", "Number/Description"}


def _bucket(words, x_min, x_max):
    """Words in an x0 range, sorted by top, plus the parallel top list for bisect."""
    b = sorted((w for w in words if x_min <= w["x0"] < x_max), key=lambda w: w["top"])
    return b, [w["top"] for w in b]


def _line_words(bucket, tops, line_top, tol=4):
    """Bucket words on one printed line (|top - line_top| <= tol), in x order."""
    i = bisect.bisect_left(tops, line_top - tol)
    j = bisect.bisect_right(tops, line_top + tol)
    return sorted(bucket[i:j], key=lambda w: w["x0"])


def _extract_new_world_records(words):
    """
    Extract permit records from a stitched New World word stream.

    Anchors on permit-number words (x<130) using EXACT top coordinates.
    Row-band rounding is unreliable here: adjacent print lines can sit <9 pts
    apart and merge, which drops the date row or interleaves the street
    address with the "WINTER SPRINGS, FL" city line. Words are pre-bucketed
    by column x-range and bisected by top so the multi-thousand-record stream
    stays linear.
    """
    anchors = sorted(
        (w for w in words if w["x0"] < 130 and _PERMIT_RE.match(w["text"])),
        key=lambda w: w["top"],
    )
    est_tops = sorted(
        w["top"] for w in words if w["x0"] < 130 and _EST_VALUE_RE.match(w["text"])
    )
    status_b, status_tops = _bucket(words, 130, 230)
    parcel_b, parcel_tops = _bucket(words, 340, 520)
    date_b, date_tops = _bucket(words, 130, 200)
    addr_b, addr_tops = _bucket(words, 340, 490)
    desc_b, desc_tops = _bucket(words, 580, 1e12)

    records = []
    for a in anchors:
        ptop = a["top"]
        permit_number = a["text"]
        # Record extent ends at the next "Estimated Value" delimiter row
        k = bisect.bisect_right(est_tops, ptop + 2)
        est_top = est_tops[k] if k < len(est_tops) else ptop + 50

        # Status: x 130-230 on the permit line, minus the "Permit" prefix
        status_parts = [
            w["text"]
            for w in _line_words(status_b, status_tops, ptop)
            if not _DATE_RE.match(w["text"])
        ]
        if status_parts and status_parts[0].lower() == "permit":
            status_parts = status_parts[1:]
        status = " ".join(status_parts).strip()

        # Parcel: alphanumeric >=8 chars at x 340-520 on the permit line
        parcel = next(
            (
                w["text"]
                for w in _line_words(parcel_b, parcel_tops, ptop)
                if re.match(r"^[A-Z0-9]{8,}$", w["text"], re.I)
            ),
            "",
        )

        # Issue date: first MM/DD/YYYY at x 130-200 between the permit line and
        # the "Estimated" delimiter (it can sit <9 pts below the permit line)
        di = bisect.bisect_right(date_tops, ptop - 4)
        dj = bisect.bisect_left(date_tops, est_top)
        date_w = next((w for w in date_b[di:dj] if _DATE_RE.match(w["text"])), None)
        date_str = date_w["text"] if date_w else ""

        # Address: x 340-490 on the same printed line as the date — excludes the
        # parcel line above, the city line below, and "Paid:" at x~497
        address = ""
        description_parts = []
        if date_w:
            dtop = date_w["top"]
            address = " ".join(
                w["text"] for w in _line_words(addr_b, addr_tops, dtop)
            ).strip()
            # Description overflow: x >= 580 from the date line down to the
            # delimiter (capped at +30 pts), ordered line-by-line (3-pt
            # buckets). Date/time/heading tokens from page footers and the
            # repeated column header are filtered for cross-page records.
            ci = bisect.bisect_left(desc_tops, dtop - 4)
            cj = bisect.bisect_left(desc_tops, min(est_top, dtop + 30))
            desc_ws = [
                w
                for w in desc_b[ci:cj]
                if not _DATE_RE.match(w["text"])
                and not _TIME_RE.match(w["text"])
                and w["text"] not in _PAGE_FURNITURE
            ]
            desc_ws.sort(key=lambda w: (round(w["top"] / 3), w["x0"]))
            description_parts = [w["text"] for w in desc_ws]

        if address and not re.search(r"FL\s+32708", address, re.I):
            address = address + ", WINTER SPRINGS, FL 32708"

        # New World PDFs are ROOF-ONLY listings (every page shows "Type: ROOF"),
        # so every row gets a "ROOF" prefix the ingest roof_filter (^ROOF\b)
        # matches deterministically; free text rides along for the audit trail.
        description_overflow = " ".join(description_parts).strip()
        if description_overflow and re.search(r"[A-Z]{3,}", description_overflow, re.I):
            description = f"ROOF: {description_overflow}"
        else:
            description = "ROOF"

        if permit_number and address and date_str:
            records.append(
                {
                    "PERMIT_NUMBER": permit_number,
                    "PARCEL_NUMBER": parcel,
                    "ADDRESS": address,
                    "ISSUE_DATE": date_str,
                    "STATUS": status,
                    "DESCRIPTION": description,
                }
            )

    return records


def extract_new_world(pdf_path):
    """
    Extract all records from one New World PDF.

    Pages are stitched into one word stream with cumulative top offsets so
    records that split across page breaks (permit row at a page bottom, date
    row after the next page's header) still assemble.
    """
    words = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            offset = i * page.height
            for w in page.extract_words():
                words.append({"text": w["text"], "x0": w["x0"], "top": w["top"] + offset})
    return _extract_new_world_records(words)


# ---------------------------------------------------------------------------
# Energov helpers
# ---------------------------------------------------------------------------
# The Energov PDF uses a CIDFont+F1 with private-use-area encoding.
# Decoding rule: subtract 0xF000 from each char code, then REVERSE the string.
# The layout is rotated 90°: each permit is a vertical column of ttb words.
# Words are BOTTOM-aligned within fixed field slots ('top' shifts up for longer
# strings, so 'bottom' is the reliable anchor). Measured slot bottoms:
#   parcel 102 | address (+zip tail) 438 | status 506 | workclass + issue-date
#   594 | type + application-date + description 684 | permit number 774.
# Column x-spacing VARIES per page (49-109 pts), so each column window runs
# from its anchor to the next anchor. The page footer rail (x~583: "Page N of
# 906", city-hall address bottom=478, "April 21, 2026" bottom=768) lands in no
# field slot, so bottom-anchoring also keeps the footer out.

_ENERGOV_DATE_RE = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")
_ENERGOV_MONEY_RE = re.compile(r"^\$[\d,]+\.\d{2}")
_ENERGOV_NUMERIC_RE = re.compile(r"^[\s\d,]+$")


def _decode_energov(text):
    """Decode Energov PUA-encoded text: subtract 0xF000, reverse."""
    decoded = "".join(chr(ord(c) - 0xF000) if ord(c) >= 0xF000 else c for c in text)
    return decoded[::-1]


def _energov_words_for_page(page):
    """Return decoded words for one Energov page with positions."""
    result = []
    for w in page.extract_words():
        decoded = _decode_energov(w["text"]).strip()
        if decoded:
            result.append(
                {"text": decoded, "x0": w["x0"], "bottom": w["bottom"]}
            )
    return result


def _energov_slot(col_words, bot_min, bot_max):
    """Column words whose bottom falls in a field slot, in x (reading) order."""
    return sorted(
        (w for w in col_words if bot_min <= w["bottom"] <= bot_max),
        key=lambda w: w["x0"],
    )


def _energov_record_from_column(pw, col_words):
    """Build one record from an anchor word + its column words, or None."""
    permit_number = pw["text"].rstrip("*")  # strip re-issue marker

    # Parcel: pieces bottom-aligned at ~102, concatenated in x order
    parcel = "".join(
        w["text"] for w in _energov_slot(col_words, 90, 115)
        if not w["text"].startswith("Description:")
    ).strip()

    # Main Address: slot bottom ~438 (shared with fee/inspection-date words —
    # excluded by pattern). Main string carries commas; bare 5-digit ZIP
    # overflow joins as the tail (x order = reading order).
    addr_parts = []
    for w in _energov_slot(col_words, 425, 452):
        t = w["text"]
        if _ENERGOV_DATE_RE.match(t) or _ENERGOV_MONEY_RE.match(t):
            continue
        if t.startswith("Description:"):
            continue
        if "," in t or re.match(r"^\d{5}$", t):
            addr_parts.append(t)
    address = " ".join(addr_parts).strip()

    # Status: slot bottom ~506 (shared with expiration date + valuation)
    status = " ".join(
        w["text"] for w in _energov_slot(col_words, 498, 514)
        if not _ENERGOV_DATE_RE.match(w["text"])
        and not _ENERGOV_MONEY_RE.match(w["text"])
        and not w["text"].startswith("Description:")
    ).strip()

    # Workclass: slot bottom ~594 (shared with issue date + sq-ft number)
    workclass = " ".join(
        w["text"] for w in _energov_slot(col_words, 586, 602)
        if not _ENERGOV_DATE_RE.match(w["text"])
        and not _ENERGOV_NUMERIC_RE.match(w["text"])
        and not w["text"].startswith("Description:")
    ).strip()

    # Issue Date: the only date slot bottom-aligned at ~594
    issue_date = next(
        (
            w["text"] for w in _energov_slot(col_words, 586, 602)
            if _ENERGOV_DATE_RE.match(w["text"])
        ),
        "",
    )

    # Description: workclass prefix + any "Description:"-prefixed free text.
    # The workclass (Roof / Solar / Sign / Shed / Screen Enclosure / Right of
    # Way) is the authoritative type, so the ingest roof_filter (^ROOF\b)
    # decides on it — free text alone is unreliable (roof permits without
    # "roof" in the text; solar permits saying "ROOF MOUNTED PV").
    desc_text = next(
        (
            w["text"].split("Description:", 1)[1].strip()
            for w in sorted(col_words, key=lambda w: w["x0"])
            if "Description:" in w["text"]
        ),
        "",
    )
    description = f"{workclass}: {desc_text}" if workclass and desc_text else (workclass or desc_text)

    if permit_number and address and issue_date:
        return {
            "PERMIT_NUMBER": permit_number,
            "PARCEL_NUMBER": parcel,
            "ADDRESS": address,
            "ISSUE_DATE": issue_date,
            "STATUS": status,
            "DESCRIPTION": description,
        }
    return None


def extract_energov(pdf_path):
    """
    Extract all records from the Energov PDF.

    Anchors on permit numbers (bottom 765-785, x>100). Column window i spans
    [anchor_i - 5, anchor_{i+1} - 5); the last window extends by the median
    anchor gap. A page's LAST record can wrap: its right-hand sub-lines
    (dates / fees / description) print at the START of the next page, left of
    that page's first anchor — so each page's last column is held and merged
    with the next page's orphan region (x in [95, first_anchor - 5)) before
    being emitted.
    """
    records = []
    held = None  # (anchor, col_words) of previous page's last column
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = _energov_words_for_page(page)
            anchors = sorted(
                (
                    w for w in words
                    if 765 <= w["bottom"] <= 785 and w["x0"] > 100
                    and re.match(r"^[A-Z]{2,6}-\d{4}-\d{4}", w["text"])
                ),
                key=lambda w: w["x0"],
            )

            if held is not None:
                first_x = anchors[0]["x0"] if anchors else 600.0
                orphan = [w for w in words if 95 <= w["x0"] < first_x - 5]
                rec = _energov_record_from_column(held[0], held[1] + orphan)
                if rec:
                    records.append(rec)
                held = None

            if not anchors:
                continue
            gaps = [b["x0"] - a["x0"] for a, b in zip(anchors, anchors[1:])]
            median_gap = sorted(gaps)[len(gaps) // 2] if gaps else 59.0

            for i, pw in enumerate(anchors):
                col_end = (
                    anchors[i + 1]["x0"] - 5
                    if i + 1 < len(anchors)
                    else pw["x0"] + median_gap - 5
                )
                col_words = [w for w in words if pw["x0"] - 5 <= w["x0"] < col_end]
                if i + 1 < len(anchors):
                    rec = _energov_record_from_column(pw, col_words)
                    if rec:
                        records.append(rec)
                else:
                    held = (pw, col_words)

    if held is not None:
        rec = _energov_record_from_column(held[0], held[1])
        if rec:
            records.append(rec)
    return records


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    all_records = []

    # --- New World PDFs ---
    for fname in NEW_WORLD_PDFS:
        fpath = os.path.join(INBOX, fname)
        records = extract_new_world(fpath)
        print(f"{fname}: {len(records)} records")
        if records:
            print("  Sample rows:")
            for r in records[:3]:
                print(f"    {r}")
        all_records.extend(records)

    # --- Energov PDF ---
    fpath = os.path.join(INBOX, ENERGOV_PDF)
    energov_records = extract_energov(fpath)
    print(f"{ENERGOV_PDF}: {len(energov_records)} records")
    if energov_records:
        print("  Sample rows:")
        for r in energov_records[:3]:
            print(f"    {r}")
    all_records.extend(energov_records)

    # --- Write combined CSV ---
    os.makedirs(INBOX, exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        writer.writeheader()
        writer.writerows(all_records)

    print(f"\nTotal records written: {len(all_records)}")
    print(f"Output: {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
