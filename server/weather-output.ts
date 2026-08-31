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
const WIND_DIRECTIONS_16 = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
const WIND_DIRECTIONS_8 = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"] as const;
const WIND_DIRECTION_TOKEN = WIND_DIRECTIONS_16.slice().sort((a, b) => b.length - a.length).join("|");

function normalizeWindDirection(direction: string): typeof WIND_DIRECTIONS_8[number] {
  const index = WIND_DIRECTIONS_16.indexOf(direction.toUpperCase() as typeof WIND_DIRECTIONS_16[number]);
  return index === -1
    ? "N"
    : WIND_DIRECTIONS_8[Math.round(index / 2) % WIND_DIRECTIONS_8.length];
}

export function normalizeWindDirectionMentions(text: string): string {
  const pairPattern = new RegExp(`\\b(${WIND_DIRECTION_TOKEN})\\s*/\\s*(${WIND_DIRECTION_TOKEN})\\b`, "gi");
  return text.replace(pairPattern, (_match, first: string, second: string) => {
    const normalizedFirst = normalizeWindDirection(first);
    const normalizedSecond = normalizeWindDirection(second);
    const firstIndex = WIND_DIRECTIONS_8.indexOf(normalizedFirst);
    const secondIndex = WIND_DIRECTIONS_8.indexOf(normalizedSecond);
    const shortestDelta = ((secondIndex - firstIndex + 4) % 8) - 4;
    const midpoint = (firstIndex + shortestDelta / 2 + 8) % 8;
    return WIND_DIRECTIONS_8[Math.round(midpoint) % WIND_DIRECTIONS_8.length];
  }).replace(new RegExp(`\\b(${WIND_DIRECTION_TOKEN})\\b`, "gi"), (_match, direction: string) =>
    normalizeWindDirection(direction),
  );
}

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
Schreibe auf Deutsch, sachlich-professionell, kurz und als Bullet-Points.
Verwende nur die bereitgestellten Daten; erfinde keine Werte, Quellen oder Entwicklungen.
Halte den untenstehenden Ausgabeumfang und die Abschnittsmarker exakt ein.
Keine Begrüßung, keine Floskeln, keine zusätzlichen Überschriften, kein Fettdruck.`;

const GLOBAL_OUTPUT_RULES = `=== PRIORITÄTEN UND AUSGABEVERTRAG ===
1. Konkrete lokale Daten haben Vorrang. Nationale Warnungen und konkrete nationale Ortsinformationen dürfen lokale Daten ergänzen, aber nicht stillschweigend ersetzen.
2. Keine Zahl, Uhrzeit, Windrichtung, Welle, Front oder Wetterentwicklung erfinden. Wenn Daten fehlen, transparent bleiben.
3. Erzeuge exakt diese vier Marker in dieser Reihenfolge:
===airPressureMasses===
===weatherFront===
===windWaves===
===cloudsRain===
Danach exakt ===END===. Keine Erklärung außerhalb dieser Marker.
4. Abschnitt 1 enthält genau 2 Bullets, Abschnitt 2 genau 2 und Abschnitt 4 genau 3. Abschnitt 3 enthält vier Prognosebullets plus die Warnzeile, wenn eine Warnquelle angebunden ist; insgesamt höchstens 5.
5. Bullet-Text bleibt kurz. Emojis stehen in Abschnitt 1 und 2 passend am Bullet-Anfang; in Abschnitt 3 und 4 direkt vor dem jeweiligen Inhalt.`;

const SECTION_1_RULES = `=== ABSCHNITT 1: airPressureMasses — Druck & Luftmassen ===
Input: Bilder, Meteonews und nationale Synopsis; lokale Wetterdaten nicht verwenden.
- Genau 2 Bullets, maximal 20 Wörter je Bullet.
- Bullet 1 beginnt mit 🌀 und beschreibt dominante Drucksysteme über Europa und ihre Bewegungsrichtung. Keine farbigen Kreise (🔵, 🟠, 🔴).
- Bullet 2 beginnt mit 🌡️ und beschreibt großräumige Luftmassen: kalt/warm, feucht/trocken, Luftmassengrenzen oder Gradienten.
- Keine lokalen Windströmungen oder Windstärken, keine Niederschlagserwähnung.
- Keine Temperaturangaben in °C oder Grad.`;

const SECTION_2_RULES = `=== ABSCHNITT 2: weatherFront — Fronten ===
Input: Bilder, Meteonews und nationale Synopsis.
- Genau 2 Bullets, maximal 20 Wörter je Bullet.
- Bullet 1: Aktive Fronten — nur Kalt- oder Warmfront, Position und Bewegung. Okklusionen weglassen. Wenn keine aktive Kalt- oder Warmfront vorliegt: "Keine aktive Kalt- oder Warmfront."
- Bullet 2: Nächste relevante Front für den Zielort und Zeitpunkt.
- Keine Frontwirkungen, kein Regen und kein Wind; nur Fronttyp, Position und Bewegungsrichtung.`;

const WIND_PEAK_TIMING_RULE = `=== WINDDATEN ===
Der kanonische Block LOKALER STÜNDLICHER WIND enthält pro Zeile Datum, Uhrzeit, Richtung, Wind_kt und Böe_kt.
Wind_kt und Böe_kt derselben Zeile bilden immer ein untrennbares Paar.
Die stärkste Böe darf ausschließlich ihrer tatsächlichen Tagesphase zugeordnet werden.`;

const WIND_DIRECTION_RULE = `Windrichtungen im Nutzertext werden auf acht Richtungen reduziert: N, NO, O, SO, S, SW, W und NW.`;

function buildSection3Rules(
  locationLabel: string,
  todayLabel: string,
  tomorrowLabel: string,
  dayAfterTomorrowLabel: string,
  forecastTailLabel: string,
): string {
  return `=== ABSCHNITT 3: windWaves — Wind & Welle ===
Inputs: der kanonische Block LOKALER STÜNDLICHER WIND, preprocessed.local.wave und geprüfte Warnungen. Europäische und nationale Texte liefern nur ergänzenden Kontext.
- Genau 4 Prognosebullets: Heute (${todayLabel}), Morgen (${tomorrowLabel}), Übermorgen (${dayAfterTomorrowLabel}) und ${forecastTailLabel}. Bei angebundener Warnquelle steht davor genau eine Warnzeile; insgesamt höchstens 5 Bullets.
- Bei angebundener Warnquelle die geprüfte Warnung aus preprocessed.local.warnings vollständig und unverändert übernehmen. "Keine Sturmwarnung" ohne ⚠️ ausgeben; aktive Warnungen oder Abruffehler dürfen ⚠️ erhalten. Bei nicht angebundener Quelle keine Warnzeile erzeugen.
- Prognosebullets 2–5 beginnen jeweils mit ihrem Zeit-/Datumspräfix, niemals mit einem Emoji. Heute und Morgen enthalten Wind und nur bei vorhandenen preprocessed.local.wave.text_de die passende Seegangsstärke im selben Bullet; Wellendaten als Douglas-Skala, ohne Richtung, Periode oder Dünung.
- Die Tabelle ist für konkrete Werte maßgeblich: Wind_kt und Böe_kt derselben Zeile gehören zusammen. Ein konkreter Wert wird immer als Bereich ausgegeben, z.B. "Meltemi NW 23–32 kt"; niemals nur den Windwert nennen und niemals "Wind 3 kt, Böen 6 kt".
- Interpretiere den Verlauf statt alle Stunden aufzuzählen. Nenne höchstens 1–2 markante Entwicklungen wie Verstärkung, Abschwächung, Richtungswechsel, Flaute oder starke/stürmische Phase. Heute sind konkrete Uhrzeiten, morgen nur grobe Tageszeiten erlaubt.
- "böig" höchstens einmal und nur, wenn der jeweilige Tagesblock dies ausdrücklich stützt. Niemals "ungewöhnlich böig". Keine separate Böen-Spitze, kein "Böen bis …" und keine redundante Wiederholung desselben oberen Windwerts.
- Übermorgen nur die wichtigste Tendenz ohne Stundenwerte. Der letzte Bullet beginnt exakt mit "${forecastTailLabel}:" und fasst die weiteren Tage großflächig zusammen; pro Tag höchstens eine Windstärkekategorie.
- Nur die acht Richtungen N, NO, O, SO, S, SW, W und NW verwenden. Bei Windstärken ab 40 kn ⚠️ ergänzen. Wenn Winddaten fehlen, transparent "Windprognose aus regionalem Wetterbericht nicht verfügbar." ausgeben.
- Für ${locationLabel} dürfen geographisch passende Windsysteme genannt werden, aber sie ersetzen niemals die lokalen Tabellenwerte.`;
}

function buildSection4Rules(
  todayLabel: string,
  tomorrowLabel: string,
  forecastOverviewLabel: string,
): string {
  return `=== ABSCHNITT 4: cloudsRain — Wetter & Regen ===
Input: ENTWICKLUNGS- UND LAGEKONTEXT FÜR ABSCHNITT 4 und KNMI-Frontkarten; Wind- und Wellendaten nicht verwenden.
- Genau 3 Bullets in dieser Reihenfolge: Heute (${todayLabel}), Morgen (${tomorrowLabel}), ${forecastOverviewLabel}. Jeder Bullet beginnt mit seinem Zeit-/Datumspräfix, niemals mit einem Emoji.
- INTERPRETIERE Auffälligkeiten und Veränderungen, statt Meteogrammwerte aufzuzählen. Priorität: markanter Drucktrend, Niederschlagsfenster/-spitze, rascher Temperaturwechsel, belastbares Gewittersignal und deutlicher Wetterumschwung. Bewölkung nur bei relevantem Wechsel.
- Heute granular, aber kompakt: höchstens 2–3 wichtigste Entwicklungen in zeitlicher Reihenfolge. Regen als qualitative zusammengefasste Phase; konkrete Uhrzeit nur für markanten Beginn oder Höhepunkt. Temperaturen auf ganze °C runden; Temperaturänderungen nur mit groben Tagesphasen. Einen normalen abendlichen Rückgang und kleine Stundenänderungen bis 3°C nicht erwähnen.
- Morgen weniger granular: nur nachts, morgens, mittags, nachmittags oder abends, keine Ziffer-Uhrzeiten. ${forecastOverviewLabel} ausschließlich als High-Level-Trend der folgenden vier Tage, ohne Uhrzeiten oder Tagesphasen.
- Bei fehlender Auffälligkeit den stabilen Charakter inhaltlich beschreiben, nicht nur "Keine markante Wetterentwicklung erkennbar." Eine gestützte Hochdrucklage mit Wärme, Sonnenschein, Trockenheit oder Stabilität darf genannt werden.
- Lokale und nationale Informationen haben Vorrang; europäische Lage und Frontkarten liefern nur den Zusammenhang. Einen lokalen Druckfall nur mit passender Front oder Synopsis als Frontdurchgang bezeichnen, sonst als Wetterwechsel oder zunehmenden Tiefdruckeinfluss.
- Druck nur bei localForecast.summary.pressure.significant=true erwähnen; unter 4 hPa pro Tag weglassen. Druckänderung ist kein Gewitterindikator.
- Gewitter ausschließlich bei localForecast.summary.thunderstorm.signal=true oder konkreter nationaler Gewitterinformation für Ort und Zeitraum. CAPE allein reicht nicht.
- Regen ausschließlich qualitativ beschreiben. Keine Niederschlagsmengen, "mm", Wolkenprozente, WMO-Codes oder routinemäßige Aufzählungen von Einzelwerten. Passende Icons direkt vor der jeweiligen Entwicklung.
- Falls localForecast fehlt, trotzdem alle 3 Bullets mit korrekten Präfixen und transparenter Nichtverfügbarkeit erzeugen.`;
}

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

function normalizeSection1Icons(text: string | null): string | null {
  if (!text) return text;
  const leadingIcon = /^(?:🔵|🟠|🔴|🟢|🟡|🟣|⚪|⚫|🌀|🧭|🌡️)\s*/u;
  let bulletIndex = 0;
  return text.split("\n").map((line) => {
    const match = line.match(/^(\s*-\s*)(.*)$/);
    if (!match || bulletIndex >= 2) return line;
    const icon = bulletIndex++ === 0 ? "🌀" : "🌡️";
    return `${match[1]}${icon} ${match[2].replace(leadingIcon, "")}`;
  }).join("\n");
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
  const section3WindContext = (local["wind"] as Record<string, unknown> | undefined) ?? {};
  const section3WindHourlyInput = typeof section3WindContext.hourlyText_de === "string"
    ? section3WindContext.hourlyText_de
    : "(nicht verfügbar)";
  const section3LocalContext = Object.fromEntries(
    Object.entries(local).filter(([key]) => ![
      "wind",
      "cloudRainThunderstorm",
      "nationalWind",
      "nationalCloudRain",
      "temperature",
      "nationalTemperature",
    ].includes(key)),
  );
  const section4Days = Array.isArray((section4LocalForecast as any)?.days)
    ? (section4LocalForecast as any).days as any[]
    : [];
  const nationalThunderstormEvidence = /\b(?:Gewitter|thunderstorm)\b/i.test(
    JSON.stringify({
      nationalLocalWeather: section4Context.nationalLocalWeather,
      nationalWarning: section4Context.nationalWarning,
    }),
  );
  const section4OutputConstraints = {
    pressureSignificant: [
      section4Days[0]?.summary?.pressure?.significant === true,
      section4Days[1]?.summary?.pressure?.significant === true,
      section4Days.slice(2).some(day => day?.summary?.pressure?.significant === true),
    ],
    thunderstormAllowed: [
      nationalThunderstormEvidence || section4Days[0]?.summary?.thunderstorm?.signal === true,
      nationalThunderstormEvidence || section4Days[1]?.summary?.thunderstorm?.signal === true,
      nationalThunderstormEvidence || section4Days.slice(2).some(day => day?.summary?.thunderstorm?.signal === true),
    ],
  };
  const section4Fallback = buildSection4Fallback(
    section4Days,
    { todayLabel, tomorrowLabel, forecastOverviewLabel },
    /\bHochdruck\b/i.test(
      [generalWeather, nationalSynopsis, section4Context.nationalLocalWeather]
        .filter(Boolean)
        .join(" "),
    ),
  );

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
${JSON.stringify(section3LocalContext, null, 2)}

=== LOKALER STÜNDLICHER WIND ===
Datum | Uhrzeit | Richtung | Wind_kt | Böe_kt
${section3WindHourlyInput}

=== OPTIONALER GROSSWETTERLAGEN-KONTEXT FÜR ABSCHNITT 3 ===
Europäische Wetterlage: ${generalWeather ?? "(nicht verfügbar)"}
Nationale Synopsis: ${nationalSynopsis ?? "(nicht verfügbar)"}

=== ENTWICKLUNGS- UND LAGEKONTEXT FÜR ABSCHNITT 4 ===
${JSON.stringify(section4Context, null, 2)}

=== DATENQUELLEN UND VORRANG ===
- Für Abschnitt 1 und 2 sind Bilder, Meteonews und nationale Synopsis maßgeblich.
- Für Abschnitt 3 ist LOKALER STÜNDLICHER WIND die maßgebliche Quelle für konkrete Windwerte; wave liefert die optionale Seegangsstärke. sailingareaForecast ergänzt den lokalen Windkontext.
- Für Abschnitt 4 ist localForecast mit Stadtwerten maßgeblich; nationalLocalWeather, nationalSynopsis, europeanOverview und KNMI-Frontkarten liefern Ergänzungen und großräumigen Zusammenhang.
- warnings ist ein separat geprüftes nationales Warnzentrum und wird, wenn vorhanden, in Abschnitt 3 unverändert übernommen.

=== WINDSYSTEME für ${position.country} ===
${windsystems || "(keine Daten)"}

${GLOBAL_OUTPUT_RULES}

${SECTION_1_RULES}

${SECTION_2_RULES}

${WIND_PEAK_TIMING_RULE}
${WIND_DIRECTION_RULE}
${buildSection3Rules(locationLabel, todayLabel, tomorrowLabel, dayAfterTomorrowLabel, forecastTailLabel)}

${buildSection4Rules(todayLabel, tomorrowLabel, forecastOverviewLabel)}
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
    const generatedWindText = parsed.windWaves
      ? softenGustyDescriptions(
        stripRedundantWindRangeMentions(
          stripRedundantGustMentions(
            combineWindAndGustMentions(
              restoreWindGustRanges(
                stripStrongestGustMentions(normalizeWindDirectionMentions(parsed.windWaves)),
                local["wind"]?.text_de,
              ),
            ),
          ),
        ),
      )
      : null;
    const windWithDatePrefixes = enforceWindForecastDatePrefixes(
      ensureWarningFirst(analysis, generatedWindText),
      { todayLabel, tomorrowLabel, dayAfterTomorrowLabel, forecastTailLabel },
    );
    const windWavesText = windWithDatePrefixes;
    return {
      airPressureMasses: { source, text: normalizeSection1Icons(parsed.airPressureMasses ?? null) },
      weatherFront:      { source, text: parsed.weatherFront ?? null },
      windWaves:         { source, text: windWavesText },
      cloudsRain:        {
        source,
        text: enforceSection4Output(
          parsed.cloudsRain ?? null,
          { todayLabel, tomorrowLabel, forecastOverviewLabel },
          section4OutputConstraints,
          section4Fallback,
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

function broadDayPeriod(hour: number): string {
  if (hour < 6 || hour >= 22) return "nachts";
  if (hour < 10) return "morgens";
  if (hour < 14) return "mittags";
  if (hour < 18) return "nachmittags";
  return "abends";
}

function replaceExactClockTimes(text: string): string {
  return text.replace(
    /\b(?:(?:ab|bis|gegen|um)\s+)?([01]?\d|2[0-3])(?::[0-5]\d)?\s*Uhr\b/gi,
    (_match, hour) => broadDayPeriod(Number(hour)),
  );
}

export function stripStrongestGustMentions(text: string): string {
  return text
    .replace(/\s*\([^()\n]*\b(?:stärkste|höchste)\s+Böe\b[^()\n]*\)/gi, "")
    .replace(
      /(?:[;,]\s*)?(?:die\s+)?(?:stärkste|höchste)\s+Böe\b[^.;\n]*(?:[.;]|$)/gi,
      "",
    )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;)])/g, "$1")
    .trim();
}

export function stripRedundantGustMentions(text: string): string {
  return text
    .replace(
      /(?:[;,]\s*|\s+)(?:(?:N|NO|O|SO|S|SW|W|NW)-)?(?:mit\s+)?Böen\b[^,.;\n]*?\b(?:kn|kt|Knoten)\b/gi,
      "",
    )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;)])/g, "$1")
    .trim();
}

export function combineWindAndGustMentions(text: string): string {
  return text.replace(
    /(\b(?:Wind\s+)?(\d+(?:[.,]\d+)?)\s*)(kn|kt)\s*,\s*(?:mit\s+)?Böen\s+(?:bis\s+zu\s+)?(\d+(?:[.,]\d+)?)\s*\3\b/gi,
    (_match, prefix, _speed, unit, gust) => `${prefix.trimEnd()}–${gust} ${unit}`,
  );
}

export function restoreWindGustRanges(text: string, localWindText: unknown): string {
  if (typeof localWindText !== "string" || !localWindText.trim()) return text;

  const rangesByDay = new Map<string, Map<number, number>>();
  for (const line of localWindText.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const dateLabel = line.slice(0, separator).trim();
    const ranges = rangesByDay.get(dateLabel) ?? new Map<number, number>();
    for (const match of line.matchAll(
      /\b\d{2}:00\s+(?:N|NO|O|SO|S|SW|W|NW)\s+Wind\s+(\d+)\s*[–-]\s*(\d+)\s*kt\b/gi,
    )) {
      ranges.set(Number(match[1]), Number(match[2]));
    }
    if (ranges.size > 0) rangesByDay.set(dateLabel, ranges);
  }

  return text.split(/\r?\n/).map(line => {
    const dateMatch = line.match(/^(?:-\s*)?(?:Heute|Morgen|Übermorgen)\s*\(([^)]+)\)/i);
    const ranges = dateMatch ? rangesByDay.get(dateMatch[1].trim()) : undefined;
    if (!ranges) return line;

    const addRange = (match: string, direction: string, speedText: string, unit: string) => {
      const gust = ranges.get(Number(speedText.replace(",", ".")));
      return typeof gust === "number"
        ? `${direction}${speedText}–${gust} ${unit}`
        : match;
    };

    return line
      .replace(
        /\b((?:N|NO|O|SO|S|SW|W|NW)\s+(?:Wind\s+)?)(\d+(?:[.,]\d+)?)\s*(kt|kn)\b/gi,
        addRange,
      )
      .replace(
        /\b(Wind\s+)(\d+(?:[.,]\d+)?)\s*(kt|kn)\b/gi,
        addRange,
      );
  }).join("\n");
}

export function stripRedundantWindRangeMentions(text: string): string {
  return text
    .replace(
      /(\bWind\s+(\d+(?:[.,]\d+)?)\s*[–-]\s*(\d+(?:[.,]\d+)?)\s*kt)(,\s*[^,.;\n]*?\b(?:bis zu|bis)\s+(\d+(?:[.,]\d+)?)\s*kt)/gi,
      (match, windRange, _minimum, maximum, _repeatedClause, repeatedMaximum) =>
        Number(maximum.replace(",", ".")) === Number(repeatedMaximum.replace(",", "."))
          ? windRange
          : match,
    )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;)])/g, "$1")
    .trim();
}

export function softenGustyDescriptions(text: string): string {
  return text
    .replace(
      /\bungewöhnlich(?:e|er|es|en)?\s+(böig(?:e|er|en|es)?)\b/gi,
      "$1",
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function roundTemperatureMentions(text: string): string {
  return text.replace(
    /(-?\d+(?:[,.]\d+))\s*°\s*C/gi,
    (_match, value) => `${Math.round(Number(value.replace(",", ".")))}°C`,
  );
}

function stripCloudPercentages(text: string): string {
  return text
    .replace(/\s*\(?\d{1,3}\s*[–-]\s*\d{1,3}\s*%\)?/g, "")
    .replace(/\s*\(?\d{1,3}\s*%\)?/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripTechnicalWeatherCodes(text: string): string {
  return text
    .replace(/\s*\(\s*WMO[-\s]?Code\s*[:#]?\s*\d{1,3}\s*\)/gi, "")
    .replace(/\bWMO[-\s]?Code\s*[:#]?\s*\d{1,3}\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripRoutineEveningCooling(text: string): string {
  return text
    .replace(
      /,\s*(?:abends|am Abend)\s+(?:(?:rascher|schneller|allmählicher|normaler)\s+)?(?:Temperatur(?:rückgang|abfall|abkühlung)|Rückgang|Abkühlung|kühler)[^.;,]*/gi,
      "",
    )
    .replace(
      /(?:abends|am Abend)\s+(?:(?:rascher|schneller|allmählicher|normaler)\s+)?(?:Temperatur(?:rückgang|abfall|abkühlung)|Rückgang|Abkühlung|kühler)[^.;,]*/gi,
      "",
    )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
}

function stripRainAmounts(text: string): string {
  return text
    // Remove parenthetical amounts first so qualitative rain wording survives.
    .replace(/\s*\([^()]*\d+(?:[,.]\d+)?\s*mm[^()]*\)/gi, "")
    // A total amount adds no information beyond the chart and leaves awkward
    // fragments if only its number is removed.
    .replace(
      /\b(?:Tages(?:summe|menge)|Gesamtsumme|Niederschlagsmenge)\b[^.;]*\d+(?:[,.]\d+)?\s*mm[^.;]*[.;]?/gi,
      "",
    )
    .replace(/(?:~|ca\.?|circa|rund|etwa)?\s*\d+(?:[,.]\d+)?\s*mm\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/;\s*([.;])/g, "$1")
    .trim();
}

function roundDecimalPressureMentions(text: string): string {
  return text.replace(
    /(-?\d+(?:[,.]\d+))\s*hPa\b/gi,
    (_match, value) => `${Math.round(Number(value.replace(",", ".")))} hPa`,
  );
}

function removeSection4Clauses(
  line: string,
  forbidden: RegExp,
): string {
  const prefixEnd = line.indexOf(":");
  if (prefixEnd === -1) return line;
  const prefix = line.slice(0, prefixEnd + 1);
  const body = line.slice(prefixEnd + 1).trim();
  const clauses = body
    .split(/;\s*|\s+—\s+/)
    .filter(clause => clause && !forbidden.test(clause));
  return clauses.length
    ? `${prefix} ${clauses.join("; ")}`
    : prefix;
}

function cloudDevelopment(cloudTypes: unknown): string {
  const types = Array.isArray(cloudTypes)
    ? cloudTypes.filter((value): value is string => typeof value === "string")
    : [];
  if (types.includes("cumulus")) return "wechselnd bewölkt mit Cumulus-Bewölkung";
  if (types.includes("clear")) return "überwiegend klar";
  if (types.includes("stratus")) return "überwiegend geschlossen bewölkt";
  if (types.includes("altostratus")) return "mit hohen und mittleren Wolkenfeldern";
  return "wechselnd bewölkt";
}

function stableDevelopment(day: any): string {
  const summary = day?.summary ?? {};
  const rainTotal = summary.rain?.totalMm;
  const temperatureMax = summary.temperature?.maxC;
  const conditions = [
    typeof rainTotal === "number" && rainTotal < 0.1
      ? "trocken"
      : "mit einzelnen Niederschlagsphasen",
    cloudDevelopment(summary.cloudTypes),
    typeof temperatureMax === "number" && temperatureMax >= 28
      ? "sommerlich warm"
      : null,
  ].filter((value): value is string => Boolean(value));
  return `Ruhiger Verlauf: ${conditions.join("; ")}; die Wetterlage bleibt im Tagesgang stabil.`;
}

function buildSection4Fallback(
  days: any[],
  labels: {
    todayLabel: string;
    tomorrowLabel: string;
    forecastOverviewLabel: string;
  },
  highPressureSupported: boolean,
): string[] {
  const unavailable = "Lokale Entwicklungsdaten nicht verfügbar.";
  const dayFallback = (day: any, label: string) =>
    day ? `- ${label}: ${stableDevelopment(day)}` : `- ${label}: ${unavailable}`;
  const overviewDays = days.slice(2);
  const overviewTemperatures = overviewDays
    .map(day => day?.summary?.temperature?.maxC)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const overviewRain = overviewDays
    .map(day => day?.summary?.rain?.totalMm)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const overviewMaxTemperature = overviewTemperatures.length
    ? Math.round(Math.max(...overviewTemperatures))
    : null;
  const overviewClouds = cloudDevelopment(
    overviewDays.flatMap(day => day?.summary?.cloudTypes ?? []),
  );
  const overviewConditions = [
    highPressureSupported ? "Mittelmeerraum unter stabiler Hochdrucklage" : "stabile Wetterlage",
    overviewClouds === "überwiegend klar" ? "verbreitet sonnig" : overviewClouds,
    overviewMaxTemperature !== null && overviewMaxTemperature >= 30
      ? `heiß mit Höchstwerten bis ${overviewMaxTemperature}°C`
      : null,
    overviewRain.length && overviewRain.every(value => value < 0.1) ? "überwiegend trocken" : null,
    "die Stabilität hält bis zum Ende des Zeitraums an",
  ].filter((value): value is string => Boolean(value));
  const overview = overviewDays.length
    ? `- ${labels.forecastOverviewLabel}: ${overviewConditions.join("; ")}.`
    : `- ${labels.forecastOverviewLabel}: ${unavailable}`;
  return [
    dayFallback(days[0], `Heute (${labels.todayLabel})`),
    dayFallback(days[1], `Morgen (${labels.tomorrowLabel})`),
    overview,
  ];
}

function isUnderDetailedOverview(line: string): boolean {
  const prefixEnd = line.indexOf(":");
  if (prefixEnd === -1) return false;
  const body = line.slice(prefixEnd + 1).trim();
  if (!/\bHochdrucklage\b/i.test(body)) return false;
  const withoutHeadline = body
    .replace(/^[☀️\s]*/u, "")
    .replace(/\bMittelmeerraum\s+unter\s+stabiler\s+Hochdrucklage\b[.;]?/i, "")
    .trim();
  return withoutHeadline.length < 15;
}

export function enforceSection4Output(
  text: string | null,
  labels: {
    todayLabel: string;
    tomorrowLabel: string;
    forecastOverviewLabel: string;
  },
  constraints?: {
    pressureSignificant?: boolean[];
    thunderstormAllowed?: boolean[];
  },
  fallbackLines?: string[],
): string | null {
  const prefixed = enforceCloudForecastDatePrefixes(text, labels);
  if (!prefixed) return prefixed;

  const bullets = prefixed
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("- "));
  if (!bullets.length) return prefixed;

  const fallback = [
    `- Heute (${labels.todayLabel}): Lokale Entwicklungsdaten nicht verfügbar.`,
    `- Morgen (${labels.tomorrowLabel}): Lokale Entwicklungsdaten nicht verfügbar.`,
    `- ${labels.forecastOverviewLabel}: Lokale Entwicklungsdaten nicht verfügbar.`,
  ];
  const exactlyThree = fallback.map((fallbackLine, index) => bullets[index] ?? fallbackLine);
  exactlyThree[1] = replaceExactClockTimes(exactlyThree[1]);
  return exactlyThree
    .map((line, index) => {
      let sanitized = removeSection4Clauses(
        roundTemperatureMentions(line),
        /(?:\bTemperatur(?:rückgang|abfall|anstieg)\b[^;]*?\b(?:[0-3](?:[,.]\d+)?)\s*°\s*C\b)/i,
      );
      sanitized = removeSection4Clauses(
        sanitized,
        /(?:\bTemperatur(?:rückgang|abfall|anstieg)\b[^;]*?\b\d{1,2}(?::[0-5]\d)?\s*[–-]\s*\d{1,2}(?::[0-5]\d)?\s*Uhr\b)/i,
      );
      sanitized = stripCloudPercentages(sanitized);
      sanitized = stripRoutineEveningCooling(sanitized);
      sanitized = stripTechnicalWeatherCodes(sanitized);
      sanitized = stripRainAmounts(sanitized);
      sanitized = roundDecimalPressureMentions(sanitized);
      if (constraints?.pressureSignificant?.[index] === false) {
        sanitized = removeSection4Clauses(sanitized, /(?:\bDruck\b|\bhPa\b|📉|📈)/i);
      }
      if (constraints?.thunderstormAllowed?.[index] === false) {
        sanitized = removeSection4Clauses(
          sanitized,
          /(?:\bGewitter\w*\b|\bCumulonimbus\b|\bCb-Signal\b|⛈️)/i,
        );
      }
      if (index === 2 && isUnderDetailedOverview(sanitized) && fallbackLines?.[index]) {
        return fallbackLines[index];
      }
      return sanitized.endsWith(":")
        ? fallbackLines?.[index] ?? `${sanitized} Lokale Entwicklungsdaten nicht verfügbar.`
        : sanitized;
    })
    .join("\n");
}

export function ensureWarningFirst(analysis: AnalysisJson, windWavesText: string | null): string | null {
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

  const remainingLines = removeNationalWarningLines(output, warningFirstLine)
    .split("\n")
    .filter((line) => !line.includes(warningFirstLine));
  return [`- ${warningPrefix}${warningText}`, ...remainingLines].filter(Boolean).join("\n");
}

function removeNationalWarningLines(text: string, authoritativeFirstLine?: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  const remaining: string[] = [];
  let skippingContinuation = false;
  for (const line of lines) {
    const isWarningLine = (
      Boolean(authoritativeFirstLine && line.includes(authoritativeFirstLine))
      || /\b(?:sturmwarnung|starkwindwarnung|unwetterwarnung|warnquelle|warnzentrum|keine\s+(?:aktive\s+)?warnung|warnung\s+von\s+(?:hnms|dhmz|lsz))\b/i.test(line)
    );
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
