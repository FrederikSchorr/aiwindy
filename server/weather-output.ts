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
const WIND_DIRECTIONS = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
const WIND_DIRECTION_TOKEN = WIND_DIRECTIONS.slice().sort((a, b) => b.length - a.length).join("|");

export function normalizeWindDirectionMentions(text: string): string {
  const pairPattern = new RegExp(`\\b(${WIND_DIRECTION_TOKEN})\\s*/\\s*(${WIND_DIRECTION_TOKEN})\\b`, "gi");
  return text.replace(pairPattern, (_match, first: string, second: string) => {
    const firstIndex = WIND_DIRECTIONS.indexOf(first.toUpperCase() as typeof WIND_DIRECTIONS[number]);
    const secondIndex = WIND_DIRECTIONS.indexOf(second.toUpperCase() as typeof WIND_DIRECTIONS[number]);
    if (firstIndex === -1 || secondIndex === -1) return first.toUpperCase();
    const shortestDelta = ((secondIndex - firstIndex + 8) % 16) - 8;
    const midpoint = (firstIndex + shortestDelta / 2 + 16) % 16;
    return WIND_DIRECTIONS[Math.round(midpoint) % 16];
  });
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
  const section3LocalContext = Object.fromEntries(
    Object.entries(local).filter(([key]) => ![
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
    rainDays: [
      section4Days.slice(0, 1),
      section4Days.slice(1, 2),
      section4Days.slice(2),
    ].map(days => days.map(day => ({
      label: typeof day?.label === "string" ? day.label : "",
      totalMm: typeof day?.summary?.rain?.totalMm === "number"
        ? day.summary.rain.totalMm
        : 0,
    }))),
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

=== OPTIONALER GROSSWETTERLAGEN-KONTEXT FÜR ABSCHNITT 3 ===
Europäische Wetterlage: ${generalWeather ?? "(nicht verfügbar)"}
Nationale Synopsis: ${nationalSynopsis ?? "(nicht verfügbar)"}

=== ENTWICKLUNGS- UND LAGEKONTEXT FÜR ABSCHNITT 4 ===
${JSON.stringify(section4Context, null, 2)}

=== QUELLEN-VORRANG FÜR LOKALE DATEN ===
- wind und wave sind die Open-Meteo-Grundversorgung für Abschnitt 3.
- localForecast enthält ausschließlich Stadtwerte und ist die zeitliche Grundversorgung für Abschnitt 4.
- wind enthält bereits die nach Zeitstempel priorisierte lokale Windreihe; strukturierte nationale Werte haben darin Vorrang vor Open-Meteo. sailingareaForecast ist eine konkrete nationale Text-Ergänzung für Abschnitt 3. nationalLocalWeather und nationalSynopsis sind konkrete nationale Ergänzungen für Abschnitt 4.
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

#3 windWaves — Wind & Welle (Inputs: lokale Wind-/Wellendaten + Windsysteme; der optionale Großwetterlagen-Kontext darf nur als übergeordnete Einordnung verwendet werden)
- Erzeuge genau diese Reihenfolge von Bullets: 1) aktuelle nationale/regionale Sturmwarnung oder der Abrufstatus der grundsätzlich angebundenen Warnquelle, 2) Heute (${todayLabel}), 3) Morgen (${tomorrowLabel}), 4) Übermorgen (${dayAfterTomorrowLabel}), 5) Danach (${forecastTailLabel}). Insgesamt maximal 5 Bullets.
- Die Warnzeile ist für eine grundsätzlich angebundene Warnquelle PFLICHT. Bei erfolgreicher Prüfung übernimm den Text aus preprocessed.local.warnings INHALTLICH UNVERÄNDERT und vollständig; auch "Keine Sturmwarnung" muss sichtbar sein, aber OHNE ⚠️-Emoji. Bei einer aktiven Sturmwarnung oder einem fehlgeschlagenen Abruf darf ⚠️ davorstehen. Keine Umformulierung, keine Kürzung und niemals eine falsche Entwarnung.
- Wenn das nationale Warnzentrum nicht angebunden ist, keine Warnzeile erzeugen. Nicht angebundene Länder zeigen diesen Status ausschließlich in der Quellenübersicht.
- Jede Prognosezeile (Bullets 2–5) MUSS mit dem relativen Zeitbezug und der konkreten Tagesbezeichnung bzw. dem Datumsbereich beginnen, niemals mit einem Emoji. Erwartetes Schema: "Heute (Sa 22.08.): ...", "Morgen (So 23.08.): ...", "Übermorgen (Mo 24.08.): ...", "Di–Do 25.–27.08.: ...".
- Die Grafik zeigt den vollständigen zeitlichen Verlauf von Windstärke und Windrichtung, aber KEINE Wellendaten. Die kompakte Grafikinterpretation betrifft daher nur Windwerte: Beschreibe NICHT jeden Zeitabschnitt, nicht jede einzelne Richtung und nicht wiederholt normale Windbereiche. Explizite Wellendaten bleiben eigenständige Pflichtinformation und dürfen nicht entfallen, nur weil der Windverlauf sichtbar ist.
- Bullet Heute und Bullet Morgen: jeweils Wind und — NUR WENN preprocessed.local.wave.text_de tatsächlich vorhanden und nicht leer ist — die passende Seegangsstärke im selben Bullet. Direkt nach dem Zeit-/Datumspräfix steht "💨" vor dem Windtext; falls Wellendaten vorhanden sind, steht "🌊" direkt vor der Welle. Wenn keine Wellendaten vorhanden sind, den Wellen-Teil vollständig weglassen: kein 🌊, kein Platzhalter und keine Erwähnung fehlender Wellendaten. Nenne ein geographisch passendes Windsystem, wenn es die Entwicklung erklärt. Beschreibe danach höchstens 1–2 markante Signale: deutliche Verstärkung oder Abschwächung, Richtungswechsel zwischen Windsystemen, Flaute, ungewöhnlicher Peak oder starke/stürmische Phase. Einen stabilen normalen Tagesverlauf nicht in mehrere Bereiche zerlegen. Heute sind für diese Signale konkrete Uhrzeiten erlaubt, morgen nur grobe Tageszeiten. Verwende Zahlenbereiche nur zur Einordnung einer markanten Änderung oder einer starken/stürmischen Phase; schreibe niemals "Böen", "mit Böen" oder "bis". Welle nur als Douglas-Skala (z.B. "See 2 schwach bewegt"), KEINE Richtung, Periode oder Dünung. Nur explizite Wellendaten verwenden, niemals schätzen.
- Bullet Übermorgen: direkt nach dem Zeit-/Datumspräfix "💨"; nur die wichtigste markante Entwicklung oder, falls keine Änderung vorliegt, eine knappe vorherrschende Tendenz. Keine Stundenwerte und keine vollständige Aufzählung von Windstärken oder Richtungen.
- Bullet Danach: beginne EXAKT mit "${forecastTailLabel}:". Setze danach "💨" vor die großflächige Zusammenfassung; nenne für jeden Tag nur eine Windstärke-Kategorie und erwähne ausschließlich deutliche Wechsel oder stürmische/kräftige Phasen. Keine Stundenwerte und keine vollständige Aufzählung von Richtungen. Eine passende Großwetterlage darf hier oder bei einer markanten Entwicklung in den Tagesbullets in einem kurzen Nebensatz ergänzt werden, wenn der optionale Kontext sie eindeutig stützt.
- Der abschließende Datumsbereichs-Bullet ist PFLICHT und darf niemals fehlen oder durch das Ende der Antwort entfallen. Wenn für die Tage danach trotz der 6-Tage-Abfrage keine Winddaten vorliegen, gib trotzdem "Di–Do [entsprechender Datumsbereich]: 💨 Winddaten für diesen Zeitraum nicht verfügbar." aus.
- Verwende die konkreten Tagesbezeichnungen aus preprocessed.local.wind. Alle Angaben müssen aus den Rohdaten stammen. Bei Windstärken ≥40 kn immer ⚠️ einfügen. Verwende ausschließlich die 16 Richtungen N, NNO, NO, ONO, O, OSO, SO, SSO, S, SSW, SW, WSW, W, WNW, NW oder NNW; niemals Richtungsbereiche mit "/" oder kombinierte Richtungsangaben. Großwetterlage und Windsysteme dürfen nur genannt werden, wenn sie geographisch und meteorologisch zum lokalen Verlauf passen; sie ersetzen niemals lokale Daten.
- Falls keine Winddaten vorhanden sind: "Windprognose aus regionalem Wetterbericht nicht verfügbar."

#4 cloudsRain — Wetter & Regen (Inputs: "ENTWICKLUNGS- UND LAGEKONTEXT FÜR ABSCHNITT 4" sowie die KNMI-Frontkarten — KEINE Wind-/Wellendaten)
- Erzeuge GENAU 3 Bullets in dieser Reihenfolge: "Heute (${todayLabel})", "Morgen (${tomorrowLabel})" und "${forecastOverviewLabel}". Jeder Bullet beginnt mit diesem Zeitbezug und Datum, niemals mit einem Emoji.
- INTERPRETIERE Auffälligkeiten und Veränderungen, statt die im Meteogramm bereits sichtbaren Werte vollständig nachzuerzählen. Priorität: markanter Drucktrend, Niederschlagsfenster/-spitze, rascher Temperaturwechsel, belastbares Gewittersignal, deutlicher Wetterumschwung. Bewölkung nur erwähnen, wenn ihr Wechsel für die Entwicklung relevant ist.
- Heute: granular. Konkrete Uhrzeiten aus localForecast.timeline sind für Regen- oder Gewitterphasen erlaubt. Nenne höchstens die 2–3 wichtigsten Entwicklungen in zeitlicher Reihenfolge, z.B. "🌧️ gegen 12 Uhr kräftiger Regen" oder "📉 ab Mittag deutlicher Druckfall". Temperaturwerte immer auf ganze °C runden; Temperaturänderungen nur mit groben Tagesphasen beschreiben und nie als einzelne benachbarte Stundenintervalle. Einen normalen abendlichen Rückgang nach dem Tagesmaximum nicht als Entwicklung erwähnen. Ein deutlich tieferes Nachtminimum darf nur als grobe Nachtentwicklung genannt werden, wenn es gegenüber dem Tagesmaximum meteorologisch relevant ist. Einzelne Temperaturänderungen von höchstens 3°C innerhalb eines Stundenintervalls nicht erwähnen.
- Morgen: weniger granular. Verwende nur grobe Tageszeiten (nachts, morgens, mittags, nachmittags, abends), KEINE Ziffer-Uhrzeiten; konzentriere dich auf die wichtigste Veränderung oder den stabilen Verlauf.
- ${forecastOverviewLabel}: fasse die folgenden vier Tage ausschließlich als High-Level-Trend zusammen. Keine Uhrzeiten, keine Tagesphasen und keine vollständige Aufzählung aller Einzelwerte.
- Schreibe niemals nur "Keine markante Wetterentwicklung erkennbar." Wenn keine Auffälligkeit vorliegt, beschreibe stattdessen den stabilen Charakter des Tages inhaltlich, z.B. trocken, Cumulus-/wechselnde Bewölkung und anhaltend sommerlich warm. Für die folgenden vier Tage ist eine Formulierung wie "Mittelmeerraum unter stabiler Hochdrucklage; verbreitet sonnig und heiß" ausdrücklich erwünscht, sofern der Lagekontext sie stützt. Der Hochdruck-Hinweis darf aber nicht den gesamten Bullet bilden: Ergänze danach 1–2 unterstützende High-Level-Details wie Wärme, Sonnenschein, Trockenheit oder die Stabilität bis zum Ende des Zeitraums.
- Verknüpfe lokale Entwicklungen mit europeanOverview, nationalSynopsis, nationalLocalWeather und den KNMI-Frontkarten. Ein markanter lokaler Druckfall darf nur dann als wahrscheinlicher Frontdurchgang bezeichnet werden, wenn eine zeitlich und räumlich passende Front bzw. nationale Synopsis dies stützt. Ohne solche Bestätigung schreibe nur "Wetterwechsel" oder "zunehmender Tiefdruckeinfluss".
- Druck nur erwähnen, wenn localForecast.summary.pressure.significant=true. Schwankungen unter 4 hPa innerhalb eines Tages sind kein relevantes Entwicklungssignal und werden weggelassen. Eine Druckänderung ist NIEMALS ein Gewitterindikator.
- Nationale konkrete Informationen und Warnungen für den Zielort haben Vorrang; die europäische Großwetterlage liefert nur den übergeordneten Zusammenhang.
- GEWITTERREGEL: Ein Gewitterrisiko darf ausschließlich erwähnt werden, wenn localForecast.summary.thunderstorm.signal=true oder ein konkreter nationaler Wetterbericht/eine Warnung Gewitter für Zielort und Zeitraum nennt. Hohe CAPE-Werte allein sind KEIN Gewittersignal. Bei signal=false weder "erhebliches" noch "geringes Gewitterrisiko" erfinden.
- Verwende passende Icons direkt vor der jeweiligen Entwicklung, z.B. 📉 Druckfall, 📈 Druckanstieg, 🌧️ Regen, ⛈️ Gewitter, 🌡️ Temperaturwechsel, 🌀 Front/Wetterwechsel, ☀️ Stabilisierung.
- Zahlen nur nennen, wenn sie eine Auffälligkeit verständlich machen. In Abschnitt 4 generell keine Kommazahlen ausgeben: Temperaturen, Niederschlagsmengen und Druckwerte auf verständliche ganze Werte runden. WOLKENPROZENTE SIND VERBOTEN. Keine Prozent-Spannen und keine routinemäßige Aufzählung von Wolken, Regen, Temperatur und Gewitter.
- Niederschlagsmengen ausschließlich aus localForecast.summary.rain.totalMm übernehmen. Eine Tagesmenge muss exakt der im Meteogramm sichtbaren Tagessumme entsprechen; niemals aus Frontkarten, Wahrscheinlichkeiten oder anderen Texten eine abweichende mm-Zahl ableiten.
- Keine technischen WMO-Codes oder Wettercode-Nummern im Nutzertext nennen. Verwende stattdessen die verständliche Wetterbeschreibung aus dem Kontext.
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
    const generatedWindText = parsed.windWaves
      ? normalizeWindDirectionMentions(parsed.windWaves)
      : null;
    const windWithDatePrefixes = enforceWindForecastDatePrefixes(
      ensureWarningFirst(analysis, generatedWindText),
      { todayLabel, tomorrowLabel, dayAfterTomorrowLabel, forecastTailLabel },
    );
    const windWavesText = windWithDatePrefixes;
    return {
      airPressureMasses: { source, text: parsed.airPressureMasses ?? null },
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

function formatRainTotal(value: number): string {
  const rounded = Math.round(value);
  return rounded < 1 ? "unter 1 mm" : `${rounded} mm`;
}

function alignRainAmounts(
  line: string,
  rainDays: Array<{ label: string; totalMm: number }>,
): string {
  const positiveDays = rainDays.filter(day => Number.isFinite(day.totalMm) && day.totalMm >= 0.05);
  const uniquePositiveTotals = Array.from(new Set(
    positiveDays.map(day => Math.round(day.totalMm * 10) / 10),
  ));
  return line.replace(
    /\b\d+(?:[,.]\d+)?\s*mm\b/gi,
    (amount, offset: number) => {
      const preceding = line.slice(Math.max(0, offset - 40), offset);
      const matchingDay = positiveDays.find(day => {
        const dayToken = day.label.split(/\s+/)[0];
        return dayToken && new RegExp(`\\b${dayToken}\\b`, "i").test(preceding);
      });
      const actual = matchingDay?.totalMm
        ?? (uniquePositiveTotals.length === 1 ? uniquePositiveTotals[0] : null);
      if (actual === null) return "";
      return formatRainTotal(actual);
    },
  ).replace(/[ \t]{2,}/g, " ");
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
    rainDays?: Array<Array<{ label: string; totalMm: number }>>;
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
      sanitized = alignRainAmounts(sanitized, constraints?.rainDays?.[index] ?? []);
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
