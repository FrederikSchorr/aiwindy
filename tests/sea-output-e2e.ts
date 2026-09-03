import fs from "node:fs/promises";
import path from "node:path";
import type { GeocodeResult, WeatherOutputData } from "../shared/schema.js";
import { hasValidWindValueFormat } from "../server/weather-output.js";

const BASE_URL = process.env.AIWINDY_TEST_BASE_URL ?? "http://127.0.0.1:5000";
const RESULT_DIR = path.join(process.cwd(), "test-results");

const LOCATIONS = [
  { country: "GR", query: "Meganisi" },
  { country: "GR", query: "Lefkada" },
  { country: "GR", query: "Paros" },
  { country: "GR", query: "Korfu" },
  { country: "GR", query: "Kos Griechenland" },
  { country: "GR", query: "Rhodos Griechenland" },
  { country: "AT", query: "Weiden am See" },
  { country: "AT", query: "Gmunden am Traunsee" },
  { country: "AT", query: "Klagenfurt am Wörthersee" },
  { country: "HR", query: "Punat Kroatien" },
  { country: "HR", query: "Split Kroatien" },
  { country: "HR", query: "Hvar Kroatien" },
] as const;

type CountryCode = typeof LOCATIONS[number]["country"];

interface AnalysisEvent {
  location?: GeocodeResult;
  weatherOutput?: WeatherOutputData;
  analysisJson?: Record<string, unknown>;
  sources?: Record<string, unknown>;
  error?: string;
  done?: boolean;
}

interface SectionCheck {
  failures: string[];
  warnings: string[];
}

interface LocationResult {
  country: CountryCode;
  query: string;
  durationMs: number;
  location: GeocodeResult | null;
  output: WeatherOutputData | null;
  checks: Record<"section1" | "section2" | "section3" | "section4" | "global", SectionCheck>;
  error: string | null;
}

const EMPTY_CHECK = (): SectionCheck => ({ failures: [], warnings: [] });
const BANNED_FALLBACK = /Lokale Entwicklungsdaten nicht verfügbar|Ruhiger Verlauf|Incomplete LLM|unvollständiger LLM|Vertrag/i;
const BANNED_FINE_DIRECTIONS = /\b(?:NNO|ONO|OSO|SSO|SSW|WSW|WNW|NNW)\b/;
const MISSING_WAVES = /keine[^.;\n]*(?:Wellen?|Wellendaten|Seegang)|(?:Wellen?|Wellendaten|Seegang)[^.;\n]*(?:nicht verfügbar|fehlen|fehlt)/i;

function bulletLines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^-\s+\S/.test(line));
}

function bodyAfterColon(line: string): string {
  const colon = line.indexOf(":");
  return (colon === -1 ? line : line.slice(colon + 1))
    .replace(/^(?:🌀|🌡️|🌍|📍|💨|🌊|☀️|⛅|☁️|🌥️|🌤️|🌧️|🌦️|⛈️|❄️|🌫️|⚠️)\s*/u, "")
    .trim();
}

function targetTokens(location: GeocodeResult | null): string[] {
  return [location?.sailingArea, location?.cityName, location?.userInput]
    .filter((value): value is string => Boolean(value))
    .flatMap(value => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().split(/[^a-z]+/))
    .filter(token => token.length >= 5 && !["kroatien", "osterreich", "griechenland", "ionisches"].includes(token));
}

function checkSubstantive(lines: string[], check: SectionCheck, label: string): void {
  lines.forEach((line, index) => {
    if (bodyAfterColon(line).length < 12) {
      check.failures.push(`${label} Bullet ${index + 1} enthält keinen substantiellen Inhalt`);
    }
  });
}

function validate(result: Omit<LocationResult, "checks">): LocationResult["checks"] {
  const checks = {
    section1: EMPTY_CHECK(),
    section2: EMPTY_CHECK(),
    section3: EMPTY_CHECK(),
    section4: EMPTY_CHECK(),
    global: EMPTY_CHECK(),
  };
  const output = result.output;
  if (!output) {
    checks.global.failures.push(result.error ?? "Keine Wetterausgabe erhalten");
    return checks;
  }

  const sectionTexts = [
    output.airPressureMasses?.text,
    output.weatherFront?.text,
    output.windWaves?.text,
    output.cloudsRain?.text,
  ];
  const allText = sectionTexts.filter(Boolean).join("\n");
  if (sectionTexts.some(text => !text?.trim())) checks.global.failures.push("Mindestens ein Abschnitt ist leer");
  if (BANNED_FALLBACK.test(allText)) checks.global.failures.push("Fallback-, Vertrags- oder interner Fehlertext sichtbar");

  const s1 = bulletLines(output.airPressureMasses?.text);
  if (s1.length !== 2) checks.section1.failures.push(`Erwartet 2 Bullets, erhalten ${s1.length}`);
  if (s1[0] && !/^-\s+🌀/.test(s1[0])) checks.section1.failures.push("Bullet 1 beginnt nicht mit 🌀");
  if (s1[1] && !/^-\s+🌡️/.test(s1[1])) checks.section1.failures.push("Bullet 2 beginnt nicht mit 🌡️");
  if (/[+-]?\d+(?:[,.]\d+)?\s*°\s*C/i.test(s1.join("\n"))) checks.section1.failures.push("Abschnitt 1 enthält lokale Temperaturwerte");
  if (!/(Hoch|Tief|Druck|Gradient|Antizyklon|Zyklon)/i.test(s1[0] ?? "")) {
    checks.section1.warnings.push("Drucksystem oder Druckentwicklung ist nicht klar erkennbar");
  }
  if (!/(Luftmass|warm|kalt|feucht|trocken|maritim|kontinental|Gradient|Grenze)/i.test(s1[1] ?? "")) {
    checks.section1.warnings.push("Luftmassencharakter ist nicht klar erkennbar");
  }
  checkSubstantive(s1, checks.section1, "Abschnitt 1");

  const s2 = bulletLines(output.weatherFront?.text);
  if (s2.length !== 2) checks.section2.failures.push(`Erwartet 2 Bullets, erhalten ${s2.length}`);
  if (s2[0] && !/^-\s+🌍/.test(s2[0])) checks.section2.failures.push("Bullet 1 beginnt nicht mit 🌍");
  if (s2[1] && !/^-\s+📍/.test(s2[1])) checks.section2.failures.push("Bullet 2 beginnt nicht mit 📍");
  if (/\b(?:Regen|Schauer|Wind|Böe|Niederschlag)\w*\b/i.test(s2.join("\n"))) {
    checks.section2.failures.push("Abschnitt 2 enthält Frontwirkungen, Wind oder Niederschlag");
  }
  if (/Okklusion/i.test(s2.join("\n"))) checks.section2.failures.push("Abschnitt 2 enthält eine Okklusion");
  const normalizedLocalFront = (s2[1] ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const tokens = targetTokens(result.location);
  if (tokens.length && !tokens.some(token => normalizedLocalFront.includes(token))) {
    checks.section2.failures.push("Lokaler Frontbullet nennt das Zielrevier nicht");
  }
  if (!/(Front|frontfrei|Kaltfront|Warmfront)/i.test(s2.join("\n"))) {
    checks.section2.warnings.push("Frontenbezug ist nicht klar erkennbar");
  }
  checkSubstantive(s2, checks.section2, "Abschnitt 2");

  const s3 = bulletLines(output.windWaves?.text);
  const forecast3 = s3.filter(line =>
    /^-\s+(?:Heute|Morgen|Übermorgen)\b/i.test(line)
    || /^-\s+(?:So|Mo|Di|Mi|Do|Fr|Sa)[–-](?:So|Mo|Di|Mi|Do|Fr|Sa)\s+\d/i.test(line),
  );
  if (forecast3.length !== 4) checks.section3.failures.push(`Erwartet 4 Prognosebullets, erhalten ${forecast3.length}`);
  const warningExpected = (
    result.country === "GR"
    || result.country === "HR"
    || (result.country === "AT" && /neusiedler/i.test(result.location?.sailingArea ?? ""))
  );
  const expectedSection3Bullets = warningExpected ? 5 : 4;
  if (s3.length !== expectedSection3Bullets) {
    checks.section3.failures.push(`Erwartet ${expectedSection3Bullets} Bullets, erhalten ${s3.length}`);
  }
  const preForecastLines = bulletLines(output.windWaves?.text)
    .filter(line => !/^\s*-\s*(?:Heute|Morgen|Übermorgen|(?:So|Mo|Di|Mi|Do|Fr|Sa)[–-])/i.test(line));
  if (warningExpected && preForecastLines.length !== 1) {
    checks.section3.failures.push(`Warnstatus erscheint ${preForecastLines.length} statt genau einmal`);
  }
  if (BANNED_FINE_DIRECTIONS.test(s3.join("\n"))) checks.section3.failures.push("Nicht erlaubte 16-Punkt-Windrichtung enthalten");
  if (!hasValidWindValueFormat(output.windWaves?.text)) {
    checks.section3.failures.push("Windwerte sind nicht durchgehend Wind–Böe-Paare oder Richtungen sind nicht achtpunktkonform");
  }
  if (MISSING_WAVES.test(s3.join("\n"))) checks.section3.failures.push("Fehlende Wellendaten werden im Nutzertext erwähnt");
  if (/\bBöen?\s+(?:bis|von)\s*\d/i.test(s3.join("\n"))) checks.section3.failures.push("Böen werden als separater Zahlenwert genannt");
  if ((s3.join("\n").match(/\bböig\b/gi) ?? []).length > 1) checks.section3.failures.push("„böig“ wird mehr als einmal verwendet");
  if (!/(zunehm|abnehm|auffrisch|nachlass|dreh|Flaute|schwach|mäßig|frisch|stark|stürm)/i.test(forecast3.join("\n"))) {
    checks.section3.warnings.push("Keine interpretierte Windentwicklung erkennbar");
  }
  const exactTimes = forecast3.join("\n").match(/\b\d{1,2}(?::\d{2})?\s*Uhr\b/g) ?? [];
  if (exactTimes.length > 3) checks.section3.warnings.push("Viele Einzelzeiten deuten auf Chart-Transkription statt Interpretation");
  if (!forecast3.slice(0, 2).some(line => /\b\d+\s*[–-]\s*\d+\s*(?:kt|kn)\b/i.test(line))) {
    checks.section3.warnings.push("Heute/Morgen enthalten keinen klaren Wind-/Böenbereich");
  }
  checkSubstantive(forecast3, checks.section3, "Abschnitt 3");

  const s4 = bulletLines(output.cloudsRain?.text);
  if (s4.length !== 3) checks.section4.failures.push(`Erwartet 3 Bullets, erhalten ${s4.length}`);
  if (!/^-\s+Heute\b/i.test(s4[0] ?? "")) checks.section4.failures.push("Heute-Bullet fehlt");
  if (!/^-\s+Morgen\b/i.test(s4[1] ?? "")) checks.section4.failures.push("Morgen-Bullet fehlt");
  if (!/^-\s+(?:So|Mo|Di|Mi|Do|Fr|Sa)[–-](?:So|Mo|Di|Mi|Do|Fr|Sa)\s+\d/i.test(s4[2] ?? "")) {
    checks.section4.failures.push("Datumsbereich-Bullet fehlt");
  }
  if (/\b\d+(?:[,.]\d+)?\s*mm\b|%|WMO[-\s]?Code/i.test(s4.join("\n"))) {
    checks.section4.failures.push("Abschnitt 4 enthält mm, Prozentwerte oder WMO-Code");
  }
  if (/\b(?:Wind|Böe|Welle|Seegang)\w*\b/i.test(s4.join("\n"))) {
    checks.section4.failures.push("Abschnitt 4 enthält Wind- oder Wellendaten");
  }
  s4.forEach((line, index) => {
    if (!/(?:☀️|⛅|☁️|🌥️|🌤️|🌧️|🌦️|⛈️|❄️|🌫️)/u.test(line)) {
      checks.section4.failures.push(`Bullet ${index + 1} enthält kein Wetter-Icon`);
    }
  });
  if (!/(bewölkt|Wolken|sonnig|klar|Regen|Schauer|trocken|Gewitter|Nebel|Druck|Temperatur|warm|kühl)/i.test(s4.join("\n"))) {
    checks.section4.warnings.push("Keine interpretierte Wetterentwicklung erkennbar");
  }
  checkSubstantive(s4, checks.section4, "Abschnitt 4");

  return checks;
}

async function readSse(response: Response): Promise<AnalysisEvent[]> {
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: AnalysisEvent[] = [];
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const records = buffer.split(/\n\n/);
    buffer = records.pop() ?? "";
    for (const record of records) {
      const dataLine = record.split(/\r?\n/).find(line => line.startsWith("data: "));
      if (!dataLine) continue;
      events.push(JSON.parse(dataLine.slice(6)) as AnalysisEvent);
    }
    if (done || events.some(event => event.done)) break;
  }
  return events;
}

async function runLocation(country: CountryCode, query: string): Promise<LocationResult> {
  const started = Date.now();
  let location: GeocodeResult | null = null;
  let output: WeatherOutputData | null = null;
  let error: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20 * 60 * 1000);
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: query, history: [], currentLocation: null }),
      signal: controller.signal,
    });
    const events = await readSse(response);
    clearTimeout(timer);
    for (const event of events) {
      if (event.location) location = event.location;
      if (event.weatherOutput) output = event.weatherOutput;
      if (event.error) error = event.error;
    }
    if (!events.some(event => event.done)) error = error ?? "SSE-Stream endete ohne done-Ereignis";
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const partial = { country, query, durationMs: Date.now() - started, location, output, error };
  return { ...partial, checks: validate(partial) };
}

function countIssues(result: LocationResult): { failures: number; warnings: number } {
  return Object.values(result.checks).reduce(
    (sum, check) => ({
      failures: sum.failures + check.failures.length,
      warnings: sum.warnings + check.warnings.length,
    }),
    { failures: 0, warnings: 0 },
  );
}

function markdown(results: LocationResult[]): string {
  const rows = results.map(result => {
    const issues = countIssues(result);
    return `| ${result.country} | ${result.query} | ${result.location?.sailingArea ?? result.location?.cityName ?? "—"} | ${issues.failures} | ${issues.warnings} | ${(result.durationMs / 1000).toFixed(1)} s |`;
  });
  const details = results.map(result => {
    const issueLines = Object.entries(result.checks).flatMap(([section, check]) => [
      ...check.failures.map(message => `- FEHLER ${section}: ${message}`),
      ...check.warnings.map(message => `- WARNUNG ${section}: ${message}`),
    ]);
    const output = result.output;
    return `## ${result.country} – ${result.query}

Erkannt: ${result.location?.displayName ?? "nicht erkannt"}  
Revier: ${result.location?.sailingArea ?? "—"}  
Fehler: ${result.error ?? "keiner"}

${issueLines.length ? issueLines.join("\n") : "- Alle automatischen Prüfungen bestanden."}

### 1. Druck & Luftmassen

${output?.airPressureMasses?.text ?? "_leer_"}

### 2. Fronten

${output?.weatherFront?.text ?? "_leer_"}

### 3. Wind & Welle

${output?.windWaves?.text ?? "_leer_"}

### 4. Wetter & Regen

${output?.cloudsRain?.text ?? "_leer_"}
`;
  });
  return `# aiWindy Mehrort-Outputtest

Basis-URL: ${BASE_URL}  
Zeitpunkt: ${new Date().toISOString()}  
Orte: ${results.length}

| Land | Eingabe | Erkanntes Revier | Fehler | Warnungen | Dauer |
|---|---|---|---:|---:|---:|
${rows.join("\n")}

${details.join("\n")}
`;
}

async function main(): Promise<void> {
  await fs.mkdir(RESULT_DIR, { recursive: true });
  const filter = process.env.AIWINDY_TEST_ONLY?.trim().toLowerCase();
  const filteredTargets = filter
    ? LOCATIONS.filter(location => location.query.toLowerCase().includes(filter))
    : [...LOCATIONS];
  const requestedLimit = Number.parseInt(process.env.AIWINDY_TEST_LIMIT ?? "", 10);
  const targets = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? filteredTargets.slice(0, requestedLimit)
    : filteredTargets;
  if (!targets.length) throw new Error(`Kein Ort passt zu AIWINDY_TEST_ONLY=${process.env.AIWINDY_TEST_ONLY}`);

  let results: LocationResult[] = [];
  if (filter && process.env.AIWINDY_TEST_MERGE === "true") {
    try {
      const previous = JSON.parse(
        await fs.readFile(path.join(RESULT_DIR, "sea-output-latest.json"), "utf8"),
      ) as { results?: LocationResult[] };
      results = previous.results ?? [];
    } catch {
      console.warn("Kein bestehender Gesamtbericht gefunden; gezielter Lauf wird separat gespeichert.");
    }
  }

  for (const [index, location] of targets.entries()) {
    process.stdout.write(`[${index + 1}/${targets.length}] ${location.query} … `);
    const result = await runLocation(location.country, location.query);
    const existingIndex = results.findIndex(existing => existing.query === location.query);
    if (existingIndex === -1) results.push(result);
    else results[existingIndex] = result;
    const issues = countIssues(result);
    console.log(`${issues.failures ? "FEHLER" : "OK"} (${issues.failures} Fehler, ${issues.warnings} Warnungen, ${(result.durationMs / 1000).toFixed(1)} s)`);
  }
  results.sort((a, b) => LOCATIONS.findIndex(location => location.query === a.query) - LOCATIONS.findIndex(location => location.query === b.query));
  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    locations: results.length,
    failures: results.reduce((sum, result) => sum + countIssues(result).failures, 0),
    warnings: results.reduce((sum, result) => sum + countIssues(result).warnings, 0),
    results,
  };
  await Promise.all([
    fs.writeFile(path.join(RESULT_DIR, "sea-output-latest.json"), JSON.stringify(summary, null, 2)),
    fs.writeFile(path.join(RESULT_DIR, "sea-output-latest.md"), markdown(results)),
  ]);
  console.log(`\nBericht: ${path.join(RESULT_DIR, "sea-output-latest.md")}`);
  if (summary.failures > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});