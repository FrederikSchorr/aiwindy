import Anthropic from "@anthropic-ai/sdk";
import windSystemsJson from "../data/windsystems.json" with { type: "json" };
import type { AnalysisJson } from "./analysis-store.js";
import {
  buildSection4WeatherContext,
  getOpenMeteoTimezone,
} from "./weather-open-meteo.js";

// ── Wind systems ──────────────────────────────────────────────────────────────

type WindSystem = { country: string; winds: Record<string, unknown>[] };

function loadWindsystems(): WindSystem[] {
  return windSystemsJson as unknown as WindSystem[];
}

function getWindsystemsForCountry(country: string): string {
  const entry = loadWindsystems().find(e => e.country === country);
  if (!entry) return "";
  return JSON.stringify(entry.winds, null, 2);
}

const SHORT_DAY_NAMES = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatCalendarDate(date: Date): string {
  return `${SHORT_DAY_NAMES[date.getUTCDay()]} ${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.`;
}

function formatCalendarRange(start: Date, end: Date): string {
  const dayRange = `${SHORT_DAY_NAMES[start.getUTCDay()]}–${SHORT_DAY_NAMES[end.getUTCDay()]}`;
  const startDay = String(start.getUTCDate()).padStart(2, "0");
  const endDay = String(end.getUTCDate()).padStart(2, "0");
  const startMonth = String(start.getUTCMonth() + 1).padStart(2, "0");
  const endMonth = String(end.getUTCMonth() + 1).padStart(2, "0");

  if (start.getUTCFullYear() === end.getUTCFullYear() && startMonth === endMonth) {
    return `${dayRange} ${startDay}.–${endDay}.${endMonth}.`;
  }
  return `${dayRange} ${startDay}.${startMonth}.–${endDay}.${endMonth}.`;
}

export function buildForecastDateLabels(
  requestDate: string,
  timeZone: string,
): {
  todayLabel: string;
  tomorrowLabel: string;
  dayAfterTomorrowLabel: string;
  forecastEndLabel: string;
  forecastTailLabel: string;
  forecastOverviewLabel: string;
  overviewStartDay: number;
  forecastEndDay: number;
} {
  const instant = new Date(requestDate);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid analysis request date: ${requestDate}`);
  }

  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(dateParts.find((item) => item.type === type)?.value);
  const localDate = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const tomorrowDate = addCalendarDays(localDate, 1);
  const overviewStartDate = addCalendarDays(localDate, 2);
  const tailStartDate = addCalendarDays(localDate, 3);
  const endDate = addCalendarDays(localDate, 5);

  return {
    todayLabel: formatCalendarDate(localDate),
    tomorrowLabel: formatCalendarDate(tomorrowDate),
    dayAfterTomorrowLabel: formatCalendarDate(overviewStartDate),
    forecastEndLabel: formatCalendarDate(endDate),
    forecastTailLabel: formatCalendarRange(tailStartDate, endDate),
    forecastOverviewLabel: formatCalendarRange(overviewStartDate, endDate),
    overviewStartDay: overviewStartDate.getUTCDate(),
    forecastEndDay: endDate.getUTCDate(),
  };
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du bist Meteorologe und Segelexperte.
STIL: Deutsch, sachlich-professionell. Bullet-Point-Stil, KURZ und PRÄGNANT.
Verwende GROSSZÜGIG passende Emojis am Anfang jedes Bullets und im Text: 🌀 💨 🌊 ☀️ ⛅ ☁️ 🌥️ 🌧️ 🌦️ ⚠️ ⛈️ 🌡️ 🧭 🌬️ ❄️ 🔵 🔴 📍 ✅.
Ausnahme für Abschnitt #3 Wind & Welle und Abschnitt #4 Wetter & Regen: Die passenden Emojis stehen direkt vor dem jeweiligen Inhalt, nicht am Anfang des Bullets.
Konkrete Zahlen, KEINE halluzinierten Werte. KEINE Begrüßung, KEINE Floskeln.
Schreibe KEINE Überschriften — nur die Bullet-Points. KEIN Fettdruck (kein **text**), nur normaler Text.`;

// ── Image helper ──────────────────────────────────────────────────────────────

function detectMediaType(base64: string): "image/png" | "image/gif" | "image/jpeg" | "image/webp" {
  const header = Buffer.from(base64.slice(0, 12), "base64");
  if (header[0] === 0x89 && header[1] === 0x50) return "image/png";
  if (header[0] === 0x47 && header[1] === 0x49) return "image/gif";
  if (header[0] === 0xff && header[1] === 0xd8) return "image/jpeg";
  return "image/png";
}

function imageBlock(base64: string | null | undefined): Anthropic.Messages.ImageBlockParam | null {
  if (!base64) return null;
  return {
    type: "image",
    source: { type: "base64", media_type: detectMediaType(base64), data: base64 },
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateWeatherOutput(
  analysis: AnalysisJson,
  anthropic: Anthropic,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const { position, weatherPreprocessed } = analysis;
  const europe = weatherPreprocessed.europe as Record<string, any>;
  const national = weatherPreprocessed.national as Record<string, any>;
  const local = weatherPreprocessed.local as Record<string, any>;

  const windsystems = getWindsystemsForCountry(position.country);
  const locationLabel = position.sailingArea?.name_de ?? position.city?.name_de ?? position.userInput;
  const cityLabel = position.city?.name_de ?? position.userInput;
  const timezone = getOpenMeteoTimezone(position.countryCode);

  const {
    todayLabel,
    tomorrowLabel,
    dayAfterTomorrowLabel,
    forecastEndLabel,
    forecastTailLabel,
    forecastOverviewLabel,
    overviewStartDay,
    forecastEndDay,
  } = buildForecastDateLabels(
    analysis.meta.requestDate,
    timezone,
  );

  // ── Build message content ─────────────────────────────────────────────────

  const content: Anthropic.Messages.ContentBlockParam[] = [];

  // Europe images (for #1 Druck & #2 Fronten)
  const wz850CurrentEntry = europe["temp850hpaCurrent"] as any;
  const wz850ForecastEntry = europe["temp850hpaForecast"] as any;
  const knmiCurrentEntry = europe["frontCurrent"] as any;
  const knmiForecastEntry = europe["frontForecast"] as any;

  const wz850Current = imageBlock(wz850CurrentEntry?.imageBase64);
  const wz850Forecast = imageBlock(wz850ForecastEntry?.imageBase64);
  const knmiCurrent = imageBlock(knmiCurrentEntry?.imageBase64);
  const knmiForecast = imageBlock(knmiForecastEntry?.imageBase64);

  const imageLabels: string[] = [];
  if (wz850Current) { imageLabels.push(`Bild 1: 850hPa-Temperaturkarte — ${wz850CurrentEntry?.timestamp ?? "Aktuell"}`); content.push(wz850Current); }
  if (wz850Forecast) { imageLabels.push(`Bild 2: 850hPa-Temperaturkarte — ${wz850ForecastEntry?.timestamp ?? "Forecast"}`); content.push(wz850Forecast); }
  if (knmiCurrent) { imageLabels.push(`Bild 3: KNMI Frontenkarte — ${knmiCurrentEntry?.timestamp ?? "Aktuell"}`); content.push(knmiCurrent); }
  if (knmiForecast) { imageLabels.push(`Bild 4: KNMI Frontenkarte — ${knmiForecastEntry?.timestamp ?? "Forecast"}`); content.push(knmiForecast); }

  const imageLabelsText = imageLabels.length > 0 ? `\n=== BILDER-ZUORDNUNG ===\n${imageLabels.join("\n")}\n` : "";

  // Text context
  const generalWeather = (europe["generalWeather"] as any)?.text_de ?? null;
  const nationalSynopsis = (national["synopsis"] as any)?.text_de ?? null;
  const section4LocalForecast = buildSection4WeatherContext(
    analysis.weatherRaw,
    timezone,
    new Date(analysis.meta.requestDate),
  );
  const section4Context = {
    targetCity: cityLabel,
    localForecast: section4LocalForecast,
    nationalLocalWeather: local["nationalCloudRain"] ?? null,
    nationalWarning: local["warnings"] ?? null,
    nationalSynopsis,
    europeanOverview: generalWeather,
    frontCharts: {
      current: knmiCurrentEntry ? {
        timestamp: knmiCurrentEntry.timestamp ?? null,
        available: Boolean(knmiCurrentEntry.imageBase64),
      } : null,
      forecast: knmiForecastEntry ? {
        timestamp: knmiForecastEntry.timestamp ?? null,
        available: Boolean(knmiForecastEntry.imageBase64),
      } : null,
    },
    fallbackLocalSummary: section4LocalForecast
      ? undefined
      : local["cloudRainThunderstorm"] ?? null,
  };

  content.push({
    type: "text",
    text: `
=== KONTEXT ===
Ort/Segelrevier: ${locationLabel}
Land: ${position.country}
${position.sailingArea ? `Segelrevier: ${position.sailingArea.name_de}` : `Ort: ${position.city?.name_de ?? position.userInput}`}
Heute: ${todayLabel}
${imageLabelsText}
=== EUROPÄISCHE WETTERLAGE (Meteonews) ===
${generalWeather ?? "(nicht verfügbar)"}

=== NATIONALE SYNOPSIS ===
${nationalSynopsis ?? "(nicht verfügbar)"}

=== LOKALE WETTERDATEN FÜR ABSCHNITT 3 (weatherPreprocessed.local) ===
${JSON.stringify(local, null, 2)}

=== ENTWICKLUNGS- UND LAGEKONTEXT FÜR ABSCHNITT 4 ===
${JSON.stringify(section4Context, null, 2)}

=== QUELLEN-VORRANG FÜR LOKALE DATEN ===
- wind und wave sind die Open-Meteo-Grundversorgung für Abschnitt 3.
- localForecast enthält ausschließlich Stadtwerte und ist die zeitliche Grundversorgung für Abschnitt 4.
- nationalWind und sailingareaForecast sind konkrete nationale Ergänzungen für Abschnitt 3; nationalLocalWeather und nationalSynopsis sind konkrete nationale Ergänzungen für Abschnitt 4. Verwende nationale Werte für die jeweils abgedeckten Zeiträume bevorzugt.
- europeanOverview und die KNMI-Frontkarten liefern Abschnitt 4 ausschließlich den großräumigen Erklärungszusammenhang. Lokale Zeitangaben stammen aus localForecast oder konkreten nationalen Daten.
- warnings ist ein separat geprüftes nationales Warnzentrum. Wenn vorhanden, seinen Text in Abschnitt 3 unverändert übernehmen.

=== WINDSYSTEME für ${position.country} ===
${windsystems || "(keine Daten)"}

=== AUFGABE ===
Erstelle genau 4 Abschnitte mit den Bullet-Points als String.

Regeln pro Abschnitt:

#1 airPressureMasses — Druck & Luftmassen (Inputs: Bilder + Meteonews + nationale Synopsis, KEINE lokalen Daten)
- GENAU 2 Bullets, max 20 Wörter je
- Bullet 1: Dominante Drucksysteme über Europa + Richtung ihrer Bewegung
- Bullet 2: Großräumige Luftmassen (kalt/warm, feucht/trocken, Luftmassengrenze, Gradienten)
- KEINE Windströmungen/stärken, KEINE Niederschlagserwähnung
- STRIKT VERBOTEN: Temperaturangaben in °C oder Grad — NIEMALS Temperaturwerte in diesem Abschnitt

#2 weatherFront — Fronten (gleiche Inputs wie #1)
- GENAU 2 Bullets, max 20 Wörter je
- Bullet 1: Aktive Front(en) — Typ, Position, Bewegung. Nenne NUR Kalt- oder Warmfronten. Okklusionen WEGLASSEN — auch wenn sie nahe sind. Falls keine aktive Kalt-/Warmfront vorhanden: "Keine aktive Kalt- oder Warmfront."
- Bullet 2: Nächste relevante Front für ${locationLabel} — Zeitpunkt
- KEINE Effekte (kein Regen, kein Wind) — nur Fronttyp, Position, Bewegungsrichtung

#3 windWaves — Wind & Welle (Inputs: NUR weatherPreprocessed.local + Windsysteme — KEINE Europakarten, KEINE nationale Synopsis)
- Erzeuge genau diese Reihenfolge von Bullets: 1) aktuelle nationale/regionale Sturmwarnung oder der Abrufstatus der grundsätzlich angebundenen Warnquelle, 2) Heute (${todayLabel}), 3) Morgen (${tomorrowLabel}), 4) Übermorgen (${dayAfterTomorrowLabel}), 5) Danach (${forecastTailLabel}). Insgesamt maximal 5 Bullets.
- Die Warnzeile ist für eine grundsätzlich angebundene Warnquelle PFLICHT. Bei erfolgreicher Prüfung übernimm den Text aus preprocessed.local.warnings INHALTLICH UNVERÄNDERT und vollständig; auch "Keine Sturmwarnung" muss sichtbar sein, aber OHNE ⚠️-Emoji. Bei einer aktiven Sturmwarnung oder einem fehlgeschlagenen Abruf darf ⚠️ davorstehen. Keine Umformulierung, keine Kürzung und niemals eine falsche Entwarnung.
- Wenn das nationale Warnzentrum nicht angebunden ist, keine Warnzeile erzeugen. Nicht angebundene Länder zeigen diesen Status ausschließlich in der Quellenübersicht.
- Jede Prognosezeile (Bullets 2–5) MUSS mit dem relativen Zeitbezug und der konkreten Tagesbezeichnung bzw. dem Datumsbereich beginnen, niemals mit einem Emoji. Erwartetes Schema: "Heute (Sa 22.08.): ...", "Morgen (So 23.08.): ...", "Übermorgen (Mo 24.08.): ...", "Di–Do 25.–27.08.: ...".
- Bullet Heute und Bullet Morgen: jeweils Wind und — NUR WENN preprocessed.local.wave.text_de tatsächlich vorhanden und nicht leer ist — die passende Seegangsstärke im selben Bullet. Direkt nach dem Zeit-/Datumspräfix steht "💨" vor dem Windtext; falls Wellendaten vorhanden sind, steht "🌊" direkt vor der Welle. Wenn keine Wellendaten vorhanden sind, den Wellen-Teil vollständig weglassen: kein 🌊, kein Platzhalter und keine Erwähnung fehlender Wellendaten. Nenne zuerst das Windsystem (z.B. "Maïstrali") und höchstens die wichtigsten Windphasen als kompakte Bereiche. Kombiniere Mittelwind und Böe IMMER zu einem Bereich im Format "WNW 14-18 kt"; schreibe niemals "Böen", "mit Böen" oder "bis". Heute dürfen wichtige Änderungen zusätzlich mit konkreten Uhrzeiten genannt werden, auch nachts. Morgen dürfen höchstens grobe Tageszeiten wie "nachts", "morgens", "mittags", "nachmittags" oder "abends" genannt werden, aber keine exakten Uhrzeiten. Welle nur als Douglas-Skala (z.B. "See 2 schwach bewegt"), KEINE Richtung, Periode oder Dünung. Nur explizite Wellendaten verwenden, niemals schätzen.
- Bullet Übermorgen: direkt nach dem Zeit-/Datumspräfix "💨", danach nur minimale bis maximale Windstärke in Knoten und die vorherrschende Windrichtung; keine Stundenwerte und keine Wellendetails.
- Bullet Danach: beginne EXAKT mit "${forecastTailLabel}:". Setze danach "💨" vor die großflächige Zusammenfassung; nenne für jeden Tag ausschließlich die Windstärke-Kategorie (stürmisch, kräftig, mäßig, schwach oder Flaute), ohne Richtungen und ohne Stundenwerte. Richtungsangaben wie N, NO, NW, W, S usw. sind in diesem Bullet VERBOTEN. Erwartetes Schema: "Di mäßig; Mi schwach bis mäßig; Do stürmisch."
- Der abschließende Datumsbereichs-Bullet ist PFLICHT und darf niemals fehlen oder durch das Ende der Antwort entfallen. Wenn für die Tage danach trotz der 6-Tage-Abfrage keine Winddaten vorliegen, gib trotzdem "Di–Do [entsprechender Datumsbereich]: 💨 Winddaten für diesen Zeitraum nicht verfügbar." aus.
- Verwende die konkreten Tagesbezeichnungen aus preprocessed.local.wind. Alle Angaben müssen aus den Rohdaten stammen. Bei Windstärken ≥40 kn immer ⚠️ einfügen.
- Falls keine Winddaten vorhanden sind: "Windprognose aus regionalem Wetterbericht nicht verfügbar."

#4 cloudsRain — Wetter & Regen (Inputs: "ENTWICKLUNGS- UND LAGEKONTEXT FÜR ABSCHNITT 4" sowie die KNMI-Frontkarten — KEINE Wind-/Wellendaten)
- Erzeuge GENAU 3 Bullets in dieser Reihenfolge: "Heute (${todayLabel})", "Morgen (${tomorrowLabel})" und "${forecastOverviewLabel}". Jeder Bullet beginnt mit diesem Zeitbezug und Datum, niemals mit einem Emoji.
- INTERPRETIERE Auffälligkeiten und Veränderungen, statt die im Meteogramm bereits sichtbaren Werte vollständig nachzuerzählen. Priorität: markanter Drucktrend, Niederschlagsfenster/-spitze, rascher Temperaturwechsel, belastbares Gewittersignal, deutlicher Wetterumschwung. Bewölkung nur erwähnen, wenn ihr Wechsel für die Entwicklung relevant ist.
- Heute: granular. Konkrete Uhrzeiten aus localForecast.timeline sind erlaubt. Nenne höchstens die 2–3 wichtigsten Entwicklungen in zeitlicher Reihenfolge, z.B. "🌧️ gegen 12 Uhr kräftiger Regen", "🌡️ danach Abkühlung auf 20–24°C" oder "📉 ab Mittag deutlicher Druckfall".
- Morgen: weniger granular. Verwende nur grobe Tageszeiten (nachts, morgens, mittags, nachmittags, abends), keine exakten Uhrzeiten; konzentriere dich auf die wichtigste Veränderung oder den stabilen Verlauf.
- ${forecastOverviewLabel}: fasse die folgenden vier Tage ausschließlich als High-Level-Trend zusammen. Keine Uhrzeiten und keine vollständige Aufzählung aller Einzelwerte.
- Verknüpfe lokale Entwicklungen mit europeanOverview, nationalSynopsis, nationalLocalWeather und den KNMI-Frontkarten. Ein markanter lokaler Druckfall darf nur dann als wahrscheinlicher Frontdurchgang bezeichnet werden, wenn eine zeitlich und räumlich passende Front bzw. nationale Synopsis dies stützt. Ohne solche Bestätigung schreibe nur "Wetterwechsel" oder "zunehmender Tiefdruckeinfluss".
- Nationale konkrete Informationen und Warnungen für den Zielort haben Vorrang; die europäische Großwetterlage liefert nur den übergeordneten Zusammenhang.
- GEWITTERREGEL: Ein Gewitterrisiko darf ausschließlich erwähnt werden, wenn localForecast.summary.thunderstorm.signal=true oder ein konkreter nationaler Wetterbericht/eine Warnung Gewitter für Zielort und Zeitraum nennt. Hohe CAPE-Werte allein sind KEIN Gewittersignal. Bei signal=false weder "erhebliches" noch "geringes Gewitterrisiko" erfinden.
- Verwende passende Icons direkt vor der jeweiligen Entwicklung, z.B. 📉 Druckfall, 📈 Druckanstieg, 🌧️ Regen, ⛈️ Gewitter, 🌡️ Temperaturwechsel, 🌀 Front/Wetterwechsel, ☀️ Stabilisierung.
- Zahlen nur nennen, wenn sie eine Auffälligkeit verständlich machen. Keine Prozent-Spannen und keine routinemäßige Aufzählung von Wolken, Regen, Temperatur und Gewitter.
- Falls localForecast fehlt, erzeuge trotzdem alle 3 Bullets mit den korrekten Präfixen und einer kurzen transparenten Nichtverfügbarkeits-Aussage; erfinde keine Entwicklung.

Antworte NUR in diesem Format, ohne weitere Erklärungen (jede Sektion beginnt mit dem Marker in einer eigenen Zeile):
===airPressureMasses===
- 🌀 ...
===weatherFront===
- 🔵 ...
===windWaves===
- 💨 ...
===cloudsRain===
- ☁️ ...
===END===
`,
  });

  // ── LLM call ──────────────────────────────────────────────────────────────

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    }, { signal });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
    const parsed = parseSectionMarkers(raw);
    if (!parsed) {
      console.error("generateWeatherOutput: no section markers in response. Raw (first 200):", raw.slice(0, 200));
     return emptyOutput(analysis);
    }

    const source = "claude-sonnet-4-6";
    const windWavesText = enforceWindForecastDatePrefixes(
      ensureWarningFirst(analysis, parsed.windWaves ?? null),
      { todayLabel, tomorrowLabel, dayAfterTomorrowLabel, forecastTailLabel },
    );
    return {
      airPressureMasses: { source, text: parsed.airPressureMasses ?? null },
      weatherFront:      { source, text: parsed.weatherFront ?? null },
      windWaves:         { source, text: windWavesText },
      cloudsRain:        {
        source,
        text: enforceCloudForecastDatePrefixes(
          parsed.cloudsRain ?? null,
          { todayLabel, tomorrowLabel, forecastOverviewLabel },
        ),
      },
    };
  } catch (e) {
    console.error("generateWeatherOutput error:", e instanceof Error ? e.message : e);
    return emptyOutput(analysis);
  }
}

const SECTION_KEYS = ["airPressureMasses", "weatherFront", "windWaves", "cloudsRain"] as const;

function parseSectionMarkers(raw: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  let found = 0;
  for (const key of SECTION_KEYS) {
    const startMarker = `===${key}===`;
    const start = raw.indexOf(startMarker);
    if (start === -1) continue;
    const contentStart = start + startMarker.length;
    // Next marker or ===END=== closes this section
    const nextMarkerIdx = SECTION_KEYS
      .filter(k => k !== key)
      .map(k => raw.indexOf(`===${k}===`, contentStart))
      .filter(i => i !== -1)
      .concat([raw.indexOf("===END===", contentStart)].filter(i => i !== -1))
      .reduce((min, i) => (i < min ? i : min), raw.length);
    result[key] = raw.slice(contentStart, nextMarkerIdx).trim();
    found++;
  }
  return found > 0 ? result : null;
}

const DATE_RANGE_PREFIX =
  /^(\s*-\s*)(?:So|Mo|Di|Mi|Do|Fr|Sa)[–-](?:So|Mo|Di|Mi|Do|Fr|Sa)\s+\d{1,2}\.(?:\d{1,2}\.)?[–-]\d{1,2}\.\d{1,2}\.?\s*:/i;

function replaceRelativeDatePrefix(
  line: string,
  relativeLabel: "Heute" | "Morgen" | "Übermorgen",
  dateLabel: string,
): string {
  const pattern = new RegExp(`^(\\s*-\\s*)${relativeLabel}(?:\\s*\\([^)]*\\))?\\s*:`, "i");
  return line.replace(pattern, `$1${relativeLabel} (${dateLabel}):`);
}

export function enforceWindForecastDatePrefixes(
  text: string | null,
  labels: {
    todayLabel: string;
    tomorrowLabel: string;
    dayAfterTomorrowLabel: string;
    forecastTailLabel: string;
  },
): string | null {
  if (!text) return text;
  return text
    .split("\n")
    .map((line) => {
      const withToday = replaceRelativeDatePrefix(line, "Heute", labels.todayLabel);
      const withTomorrow = replaceRelativeDatePrefix(withToday, "Morgen", labels.tomorrowLabel);
      const withDayAfterTomorrow = replaceRelativeDatePrefix(
        withTomorrow,
        "Übermorgen",
        labels.dayAfterTomorrowLabel,
      );
      return withDayAfterTomorrow.replace(
        DATE_RANGE_PREFIX,
        `$1${labels.forecastTailLabel}:`,
      );
    })
    .join("\n");
}

export function enforceCloudForecastDatePrefixes(
  text: string | null,
  labels: {
    todayLabel: string;
    tomorrowLabel: string;
    forecastOverviewLabel: string;
  },
): string | null {
  if (!text) return text;
  return text
    .split("\n")
    .map((line) => {
      const withToday = replaceRelativeDatePrefix(line, "Heute", labels.todayLabel);
      const withTomorrow = replaceRelativeDatePrefix(withToday, "Morgen", labels.tomorrowLabel);
      return withTomorrow.replace(
        DATE_RANGE_PREFIX,
        `$1${labels.forecastOverviewLabel}:`,
      );
    })
    .join("\n");
}

function ensureWarningFirst(analysis: AnalysisJson, windWavesText: string | null): string | null {
  const warningCenter = analysis.sources.nationalWarningCenter;
  if (!warningCenter) return windWavesText;

  const output = typeof windWavesText === "string" ? windWavesText.trim() : "";
  if (warningCenter.status === "unsupported") {
    return removeNationalWarningLines(output) || null;
  }
  if (warningCenter.status !== "integrated" && warningCenter.status !== "unavailable") {
    return windWavesText;
  }

  const warning = (analysis.weatherPreprocessed.local.warnings as {
    text_de?: unknown;
    source?: unknown;
    checked?: unknown;
  } | undefined);
  const warningText = warning?.checked === true && typeof warning.text_de === "string" && warning.text_de.trim()
    ? warning.text_de.trim()
    : `Nationale Sturmwarnquelle ${warningCenter.label ?? "des Landes"} derzeit nicht erreichbar`;
  const isNoWarning = /\bkeine\s+(?:aktive\s+)?(?:sturmwarnung|warnung)\b/i.test(warningText);
  const warningPrefix = isNoWarning ? "" : "⚠️ ";
  const warningFirstLine = warningText.split("\n")[0];

  const hasExpectedPrefix = isNoWarning
    ? output.startsWith("- ") && !output.startsWith("- ⚠️")
    : output.startsWith("- ⚠️");
  if (!isNoWarning && hasExpectedPrefix && output.includes(warningFirstLine)) {
    return output;
  }

  const remainingLines = removeNationalWarningLines(output)
    .split("\n")
    .filter((line) => !line.includes(warningFirstLine));
  return [`- ${warningPrefix}${warningText}`, ...remainingLines].filter(Boolean).join("\n");
}

function removeNationalWarningLines(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  const remaining: string[] = [];
  let skippingContinuation = false;
  for (const line of lines) {
    const isWarningLine = /\b(?:sturmwarnung|starkwindwarnung|unwetterwarnung|warnquelle|warnzentrum|keine\s+(?:aktive\s+)?warnung|warnung\s+von\s+(?:hnms|dhmz|lsz))\b/i.test(line);
    if (isWarningLine) {
      skippingContinuation = true;
      continue;
    }
    if (skippingContinuation && !/^\s*-\s+/.test(line)) continue;
    skippingContinuation = false;
    remaining.push(line);
  }
  return remaining.join("\n").trim();
}

function emptyOutput(analysis?: AnalysisJson): Record<string, unknown> {
  const source = "claude-sonnet-4-6";
  return {
    airPressureMasses: { source, text: null },
    weatherFront:      { source, text: null },
    windWaves:         { source, text: analysis ? ensureWarningFirst(analysis, null) : null },
    cloudsRain:        { source, text: null },
  };
}
