/**
 * Segelrevier-Erkennung Testsuite
 * Ausführen: npx tsx --env-file=.env tests/test-location.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { detectSegelrevier } from "../server/location.js";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

interface TestCase {
  input: string;
  expected: string | null; // null = "kein Segelrevier"
}

const TEST_CASES: TestCase[] = [
  { input: "Weiden am See",   expected: "Neusiedler See (Österreich)" },
  { input: "Wien",             expected: null },
  { input: "Adria",            expected: "Adria Mitte (Kroatien)" },
  { input: "Kvarner",          expected: "Adria Nord (Kroatien)" },
  { input: "Venedig",          expected: "Adria Nord (Italien)" },
  { input: "Zadar",            expected: "Adria Mitte (Kroatien)" },
  { input: "Gardasee",         expected: "Gardasee" },
  { input: "Traunsee",         expected: "Traunsee" },
  { input: "Kiel",             expected: "Ostsee West (Deutschland)" },
  { input: "Punat",            expected: "Adria Nord (Kroatien)" },
];

async function runTests() {
  console.log("── AIWindy Segelrevier-Testsuite ──────────────────────────────\n");

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    process.stdout.write(`  "${tc.input}" → `);

    const result = await detectSegelrevier(tc.input, anthropic);
    const got = result?.revier.deutsch ?? null;
    const expectedLabel = tc.expected ?? "kein Segelrevier";
    const gotLabel = got ?? "kein Segelrevier";

    if (got === tc.expected) {
      console.log(`✓  ${gotLabel}`);
      passed++;
    } else {
      console.log(`✗  erwartet: "${expectedLabel}"  →  AI: "${gotLabel}"`);
      if (result) {
        console.log(`       Land: ${result.land} [${result.countryCode}]  Koordinaten: ${result.revier.lat}, ${result.revier.lon}`);
      }
      failed++;
    }
  }

  console.log(`\n── Ergebnis: ${passed}/${TEST_CASES.length} bestanden, ${failed} fehlgeschlagen ──\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error("Fehler:", e);
  process.exit(1);
});
