import Anthropic from "@anthropic-ai/sdk";

// ── Constants ─────────────────────────────────────────────────────────────────

export const HNMS_GALE_URL = "http://newportal.hnms.gr/emy/en/warning/gale_html";
export const HNMS_SOURCE_URL = "https://hnms.gr/emy/en/navigation/Naftilia";

// All HNMS area headings that act as block separators (superset of our sailingareas)
const HNMS_AREA_HEADINGS = new Set([
  "NORTH ADRIATIC", "CENTRAL ADRIATIC", "SOUTH ADRIATIC", "BOOT",
  "MELITA", "GABES", "SIDRA",
  "NORTH IONIO", "SOUTH IONIO", "PATRAIKOS", "KORINTHIAKOS",
  "KITHIRA SEA", "SOUTHWEST KRITIKO", "SOUTHEAST KRITIKO IERAPETRA",
  "WEST KRITIKO", "EAST KRITIKO",
  "SARONIKOS", "SOUTH EVVOIKOS", "KAFIREAS STRAIT",
  "SOUTHWEST AEGEAN", "SOUTHEAST AEGEAN IKARIO", "SAMOS SEA",
  "CENTRAL AEGEAN", "NORTHWEST AEGEAN", "NORTHEAST AEGEAN",
  "RODOS SEA", "KARPATHIO", "KASTELLORIZO SEA",
  "THRAKIKO", "THERMAIKOS",
  "TAURUS", "DELTA", "CRUSADE",
  "MARMARA", "WEST BLACK SEA", "EAST BLACK SEA",
]);

const MONTHS: Record<string, number> = {
  JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5,
  JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11,
};

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchGreeceWeather(): Promise<{ data: Record<string, unknown>; sourceUrls: string[] }> {
  try {
    const res = await fetch(HNMS_GALE_URL, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`HNMS gale fetch failed (${res.status})`);
      return { data: { "greeceGaleWarning": { source: "HNMS", url: HNMS_GALE_URL, text: null } }, sourceUrls: [] };
    }
    const html = await res.text();
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n +/g, "\n")
      .trim();

    const idx = clean.indexOf("GALE WARNING");
    const text = idx >= 0 ? clean.slice(idx).trim() : null;

    return {
      data: { "greeceGaleWarning": { source: "HNMS", url: HNMS_GALE_URL, text } },
      sourceUrls: [HNMS_SOURCE_URL],
    };
  } catch (e) {
    console.error("fetchGreeceWeather error:", e instanceof Error ? e.message : e);
    return { data: { "greeceGaleWarning": { source: "HNMS", url: HNMS_GALE_URL, text: null } }, sourceUrls: [] };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse bulletin header timestamp like "03 APRIL 2026/0400 UTC"
 * and return a Date in UTC.
 */
function parseHnmsTimestamp(line: string): Date | null {
  const m = line.match(/(\d{1,2})\s+([A-Z]+)\s+(\d{4})\/(\d{2})(\d{2})\s+UTC/i);
  if (!m) return null;
  const [, day, mon, year, hh, mm] = m;
  const month = MONTHS[mon.toUpperCase()];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(year), month, Number(day), Number(hh), Number(mm)));
}

function formatAthenTime(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Athens",
    weekday: "short", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(date) + " Ortszeit";
}

/**
 * Determine if a line is an HNMS area heading (all-caps, matches known headings or
 * starts with a known heading prefix).
 */
function isAreaHeading(line: string): boolean {
  const upper = line.trim().toUpperCase();
  if (HNMS_AREA_HEADINGS.has(upper)) return true;
  // Some headings appear with sub-qualifiers on the same line — check prefix
  for (const h of Array.from(HNMS_AREA_HEADINGS)) {
    if (upper.startsWith(h)) return true;
  }
  return false;
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

export async function preprocessGreeceNationalSynopsis(
  text: string | null,
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  const nullResult = { "synopsis": { source: "HNMS", url: HNMS_GALE_URL, text_de: null } };
  if (!text) return nullResult;

  // Extract header timestamp (line 3: "WARNING NR 258 - FRIDAY 03 APRIL 2026/0400 UTC")
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const headerLine = lines.find(l => /WARNING NR.*UTC/i.test(l)) ?? "";
  const headerDate = parseHnmsTimestamp(headerLine);
  const timeLabel = headerDate ? `Stand: ${formatAthenTime(headerDate)}` : "";

  // Extract GENERAL SYNOPSIS block
  const synopsisMatch = text.match(/GENERAL SYNOPSIS[\s\S]*?(?=\nPART 3|\nFORECAST|\n[A-Z ]{4,}\n)/i);
  if (!synopsisMatch) return nullResult;
  const synopsisRaw = synopsisMatch[0].trim();

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Übersetze diesen englischen Seewetter-Synopsetext ins Deutsche. Behalte alle Druckwerte (hPa) und Positionen bei. Antworte nur mit der Übersetzung, ohne Erklärungen.\n\n${synopsisRaw}`,
      }],
    });
    const translated = (msg.content[0] as any)?.text?.trim() ?? null;
    const text_de = [timeLabel, translated].filter(Boolean).join("\n");
    return { "synopsis": { source: "HNMS", url: HNMS_GALE_URL, text_de } };
  } catch (e) {
    console.error("preprocessGreeceNationalSynopsis error:", e instanceof Error ? e.message : e);
    return nullResult;
  }
}

export async function extractGreeceWarning(
  text: string | null,
  emyName: string | null,
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  const nullResult = {
    "warnings": {
      source: "HNMS", url: HNMS_GALE_URL,
      sailingArea: emyName,
      text_de: "Keine Marine-Warnung von EMY",
    },
  };
  if (!text || !emyName) return nullResult;

  // Extract header timestamp
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const headerLine = lines.find(l => /WARNING NR.*UTC/i.test(l)) ?? "";
  const headerDate = parseHnmsTimestamp(headerLine);
  const timeLabel = headerDate ? `Stand: ${formatAthenTime(headerDate)}` : "";

  // Find lines matching emyName (case-insensitive)
  const target = emyName.toUpperCase();
  const matchedBlocks: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const upper = lines[i].toUpperCase();
    if (upper === target || upper.startsWith(target)) {
      // Collect this block until next area heading
      const block: string[] = [lines[i]];
      i++;
      while (i < lines.length && !isAreaHeading(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      matchedBlocks.push(block.join("\n"));
    } else {
      i++;
    }
  }

  if (!matchedBlocks.length) return nullResult;

  const blockText = matchedBlocks.join("\n\n");
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Übersetze diese englische Seewetter-Warnung für das Gebiet "${emyName}" ins Deutsche. Beaufort-Skala und nautische Begriffe beibehalten. Antworte nur mit der Übersetzung.\n\n${blockText}`,
      }],
    });
    const translated = (msg.content[0] as any)?.text?.trim() ?? null;
    const text_de = [timeLabel, translated].filter(Boolean).join("\n");
    return { "warnings": { source: "HNMS", url: HNMS_GALE_URL, sailingArea: emyName, text_de } };
  } catch (e) {
    console.error("extractGreeceWarning error:", e instanceof Error ? e.message : e);
    return nullResult;
  }
}
