import Anthropic from "@anthropic-ai/sdk";
import windSystemsJson from "../data/windsystems.json" with { type: "json" };
import type { AnalysisJson } from "./analysis-store.js";

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

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du bist Meteorologe und Segelexperte.
STIL: Deutsch, sachlich-professionell. Bullet-Point-Stil, KURZ und PRÄGNANT.
Verwende GROSSZÜGIG passende Emojis am Anfang jedes Bullets und im Text: 🌀 💨 🌊 ☀️ ⛅ ☁️ 🌥️ 🌧️ 🌦️ ⚠️ ⛈️ 🌡️ 🧭 🌬️ ❄️ 🔵 🔴 📍 ✅.
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

  const _d = new Date(analysis.meta.requestDate);
  const _days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const todayLabel = `${_days[_d.getDay()]} ${String(_d.getDate()).padStart(2, "0")}.${String(_d.getMonth() + 1).padStart(2, "0")}.`;
  const _endDate = new Date(_d.getTime() + 5 * 24 * 60 * 60 * 1000);
  const forecastEndLabel = `${_days[_endDate.getDay()]} ${String(_endDate.getDate()).padStart(2, "0")}.${String(_endDate.getMonth() + 1).padStart(2, "0")}.`;

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

=== LOKALE WETTERDATEN (weatherPreprocessed.local) ===
${JSON.stringify(local, null, 2)}

=== WINDSYSTEME für ${position.country} ===
${windsystems || "(keine Daten)"}

=== AUFGABE ===
Erstelle genau 5 Abschnitte als JSON. Jeder Abschnitt enthält einen "text"-Schlüssel mit den Bullet-Points als String (Zeilenumbrüche mit \\n).

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
- Erzeuge genau diese Reihenfolge von Bullets (sofern die jeweiligen Daten vorhanden): 1) Sturmwarnung, 2) Heute (${todayLabel}), 3) Morgen, 4) Übermorgen, 5) Danach (bis ${forecastEndLabel}). Insgesamt maximal 5 Bullets.
- Bullet 1 ist die Sturmwarnung aus preprocessed.local.warnings. Wenn sie vorhanden ist, muss ihr Text INHALTLICH UNVERÄNDERT und vollständig übernommen werden; nur das ⚠️-Emoji davor ist erlaubt. Keine Umformulierung, keine Kürzung, keine zusätzlichen Angaben.
- Bullet Heute und Bullet Morgen: jeweils Wind und die passende Welle/Dünung aus preprocessed.local.wave im selben Bullet. Wind detailliert mit zeitlichen Änderungen, Richtung, Stärke in Knoten und Böen. Welle in Douglas-Skala, KEINE Meter. Nur explizite Wellendaten verwenden, niemals schätzen.
- Bullet Übermorgen: nur minimale bis maximale Windstärke in Knoten und die vorherrschende Windrichtung; keine Stundenwerte und keine Wellendetails.
- Bullet Danach (bis ${forecastEndLabel}): fasse die Tage danach großflächig zusammen; nenne nur, ob es überwiegend stürmisch, kräftig, mäßig, schwach oder Flaute ist, plus Richtung nur wenn eindeutig. Keine Stundenwerte.
- Der Bullet "Danach" ist PFLICHT und darf niemals fehlen oder durch das Ende der Antwort entfallen. Wenn für die Tage danach trotz der 6-Tage-Abfrage keine Winddaten vorliegen, gib trotzdem "Danach (bis ${forecastEndLabel}): Winddaten für diesen Zeitraum nicht verfügbar." aus.
- Verwende die konkreten Tagesbezeichnungen aus preprocessed.local.wind. Alle Angaben müssen aus den Rohdaten stammen. Bei Windstärken ≥40 kn immer ⚠️ einfügen.
- Falls keine Winddaten vorhanden sind: "Windprognose aus regionalem Wetterbericht nicht verfügbar."

#4 cloudsRain — Wolken & Regen (Inputs: NUR weatherPreprocessed.local — KEINE Europakarten, KEINE nationale Synopsis)
- max 2 Bullets, max 20 Wörter je: Bewölkung + Regen + Gewitterrisiko. Jeder Bullet beginnt mit dem passenden Zeitbezug — Reihenfolge: "Aktuell:", "Heute:", "Morgen:", "Übermorgen:", "Nächste 24h:". Bei Gewitterrisiko immer ⛈️ einfügen. CAPE-Werte NIEMALS im Text erwähnen — nur als interne Entscheidungshilfe für Gewitterrisiko verwenden.
- Falls keine Daten: "Wetterprognose aus regionalem Wetterbericht nicht verfügbar."

#5 temperature — Temperatur (Inputs: NUR weatherPreprocessed.local — KEINE Europakarten, KEINE nationale Synopsis)
- max 1 Bullet, max 20 Wörter: Temperatur heute + morgen
- Falls keine Daten: leer lassen (leerer String)

Antworte NUR in diesem Format, ohne weitere Erklärungen (jede Sektion beginnt mit dem Marker in einer eigenen Zeile):
===airPressureMasses===
- 🌀 ...
===weatherFront===
- 🔵 ...
===windWaves===
- 💨 ...
===cloudsRain===
- ☁️ ...
===temperature===
- 🌡️ ...
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
      return emptyOutput();
    }

    const source = "claude-sonnet-4-6";
    return {
      airPressureMasses: { source, text: parsed.airPressureMasses ?? null },
      weatherFront:      { source, text: parsed.weatherFront ?? null },
      windWaves:         { source, text: parsed.windWaves ?? null },
      cloudsRain:        { source, text: parsed.cloudsRain ?? null },
      temperature:       { source, text: parsed.temperature ?? null },
    };
  } catch (e) {
    console.error("generateWeatherOutput error:", e instanceof Error ? e.message : e);
    return emptyOutput();
  }
}

const SECTION_KEYS = ["airPressureMasses", "weatherFront", "windWaves", "cloudsRain", "temperature"] as const;

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

function emptyOutput(): Record<string, unknown> {
  const source = "claude-sonnet-4-6";
  return {
    airPressureMasses: { source, text: null },
    weatherFront:      { source, text: null },
    windWaves:         { source, text: null },
    cloudsRain:        { source, text: null },
    temperature:       { source, text: null },
  };
}
