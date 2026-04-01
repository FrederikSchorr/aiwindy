import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import type { AnalysisJson } from "./analysis-store.js";

// ── Wind systems ──────────────────────────────────────────────────────────────

type WindSystem = { country: string; winds: Record<string, unknown>[] };

let _windsystems: WindSystem[] | null = null;

function loadWindsystems(): WindSystem[] {
  if (!_windsystems) {
    _windsystems = JSON.parse(
      readFileSync(new URL("../data/windsystems.json", import.meta.url), "utf-8"),
    ) as WindSystem[];
  }
  return _windsystems;
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
): Promise<Record<string, unknown>> {
  const { position, weatherPreprocessed } = analysis;
  const europe = weatherPreprocessed.europe as Record<string, any>;
  const national = weatherPreprocessed.national as Record<string, any>;
  const local = weatherPreprocessed.local as Record<string, any>;

  const windsystems = getWindsystemsForCountry(position.country);
  const locationLabel = position.sailingArea?.name_de ?? position.city?.name_de ?? position.userInput;

  // ── Build message content ─────────────────────────────────────────────────

  const content: Anthropic.Messages.ContentBlockParam[] = [];

  // Europe images (for #1 Druck & #2 Fronten)
  const wz850Current = imageBlock((europe["temp850hpa current"] as any)?.imageBase64);
  const wz850Forecast = imageBlock((europe["temp850hpa forecast"] as any)?.imageBase64);
  const knmiCurrent = imageBlock((europe["front current"] as any)?.imageBase64);
  const knmiForecast = imageBlock((europe["front forecast"] as any)?.imageBase64);

  for (const img of [wz850Current, wz850Forecast, knmiCurrent, knmiForecast]) {
    if (img) content.push(img);
  }

  // Text context
  const generalWeather = (europe["general weather"] as any)?.text_de ?? null;
  const nationalSynopsis = (national["synopsis"] as any)?.text_de ?? null;

  content.push({
    type: "text",
    text: `
=== KONTEXT ===
Ort/Segelrevier: ${locationLabel}
Land: ${position.country}
${position.sailingArea ? `Segelrevier: ${position.sailingArea.name_de}` : `Ort: ${position.city?.name_de ?? position.userInput}`}

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

#1 airPressureMasses — Druck & Luftmassen (Inputs: Bilder + Meteonews + nationale Synopsis)
- GENAU 2 Bullets, max 20 Wörter je
- Bullet 1: Dominante Drucksysteme über Europa + räumliche Anordnung + Strömungsrichtung
- Bullet 2: Großräumige Luftmassen (kalt/warm, feucht/trocken, Luftmassengrenze, Gradienten)
- KEINE Windstärken, KEINE Temperaturen in Grad, KEINE Niederschlagserwähnung

#2 weatherFront — Fronten (gleiche Inputs wie #1)
- GENAU 2 Bullets, max 20 Wörter je
- Bullet 1: Aktive Front(en) — Typ, Position, Bewegung
- Bullet 2: Nächste relevante Front für ${locationLabel} — Zeitpunkt
- KEINE Effekte (kein Regen, kein Wind) — nur Fronttyp, Position, Bewegungsrichtung

#3 windWaves — Wind & Welle (Inputs: NUR weatherPreprocessed.local + Windsysteme — KEINE Europakarten, KEINE nationale Synopsis)
- Wind: max 2 Bullets, max 40 Wörter je. Jeder Bullet beginnt mit dem passenden Zeitbezug — Reihenfolge: "Aktuell:", "Heute:", "Morgen:", "Nächste 24h:". Wenn sowohl "warnings" (→ "Aktuell:") als auch "sailingarea forecast" (→ "Nächste 24h:") vorhanden sind, MÜSSEN beide als eigene Bullets erscheinen. Alle zeitlichen Nuancen aus preprocessed.local.wind VOLLSTÄNDIG übernehmen (z.B. "vormittags", "bis mittags", "ab Nachmittag"). Nationale Windsystemnamen verwenden wenn passend. Bei Windstärken ≥40 kn immer ⚠️ einfügen.
- Falls keine Winddaten: "Windprognose aus regionalem Wetterbericht nicht verfügbar."
- Welle: max 1 Bullet. Zeitbezug-Prefix MUSS zur Quelle passen: Wellendaten aus "warnings" → "Aktuell:", aus "sailingarea forecast" → "Nächste 24h:". Douglas-Skala (1=ruhig…6=sehr rau), KEINE Meter. NUR wenn explizite Wellendaten vorhanden — NIEMALS schätzen. Weglassen wenn keine Daten.

#4 cloudsRain — Wolken & Regen (Inputs: NUR weatherPreprocessed.local — KEINE Europakarten, KEINE nationale Synopsis)
- max 2 Bullets, max 20 Wörter je: Bewölkung + Regen + Gewitterrisiko. Jeder Bullet beginnt mit dem passenden Zeitbezug — Reihenfolge: "Aktuell:", "Heute:", "Morgen:", "Nächste 24h:". Bei Gewitterrisiko immer ⛈️ einfügen.
- Falls keine Daten: "Wetterprognose aus regionalem Wetterbericht nicht verfügbar."

#5 temperature — Temperatur (Inputs: NUR weatherPreprocessed.local — KEINE Europakarten, KEINE nationale Synopsis)
- max 1 Bullet, max 20 Wörter: Temperatur heute + morgen
- Falls keine Daten: leer lassen (leerer String)

Antworte NUR mit diesem JSON-Objekt, ohne weitere Erklärungen:
{
  "airPressureMasses": "- 🌀 ...",
  "weatherFront": "- 🔵 ...",
  "windWaves": "- 💨 ...",
  "cloudsRain": "- ☁️ ...",
  "temperature": "- 🌡️ ..."
}
`,
  });

  // ── LLM call ──────────────────────────────────────────────────────────────

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("generateWeatherOutput: no JSON in response");
      return emptyOutput();
    }
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;

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
