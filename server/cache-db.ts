import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cache_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      value_binary BYTEA,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

let tableReady = false;
async function ready(): Promise<void> {
  if (tableReady) return;
  await ensureTable();
  tableReady = true;
}

export async function cacheGet(key: string): Promise<string | null> {
  await ready();
  const res = await pool.query(
    `SELECT value FROM cache_store WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [key],
  );
  return res.rows[0]?.value ?? null;
}

export async function cacheGetBinary(key: string): Promise<Buffer | null> {
  await ready();
  const res = await pool.query(
    `SELECT value_binary FROM cache_store WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [key],
  );
  return res.rows[0]?.value_binary ?? null;
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  await ready();
  const expiresAt = ttlSeconds
    ? new Date(Date.now() + ttlSeconds * 1000)
    : null;
  await pool.query(
    `INSERT INTO cache_store (key, value, expires_at, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = $3, created_at = NOW()`,
    [key, value, expiresAt],
  );
}

export async function cacheSetBinary(
  key: string,
  data: Buffer,
  metaValue: string,
  ttlSeconds?: number,
): Promise<void> {
  await ready();
  const expiresAt = ttlSeconds
    ? new Date(Date.now() + ttlSeconds * 1000)
    : null;
  await pool.query(
    `INSERT INTO cache_store (key, value, value_binary, expires_at, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, value_binary = $3, expires_at = $4, created_at = NOW()`,
    [key, metaValue, data, expiresAt],
  );
}

export async function cacheDelete(key: string): Promise<void> {
  await ready();
  await pool.query(`DELETE FROM cache_store WHERE key = $1`, [key]);
}

export async function purgeStaleIonianLocationCache(): Promise<number> {
  await ready();
  const res = await pool.query(
    `DELETE FROM cache_store
     WHERE key LIKE 'loc:%'
       AND value LIKE $1`,
    ['%"sailingArea":"Ionisches Meer Nord (Griechenland)"%'],
  );
  return res.rowCount ?? 0;
}

export async function cacheCleanExpired(): Promise<number> {
  await ready();
  const res = await pool.query(
    `DELETE FROM cache_store WHERE expires_at IS NOT NULL AND expires_at <= NOW()`,
  );
  return res.rowCount ?? 0;
}

let analysesTableReady = false;
async function ensureAnalysesTable(): Promise<void> {
  if (analysesTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analyses (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW(),
      user_input TEXT NOT NULL,
      country_code TEXT,
      sailing_area TEXT,
      city TEXT,
      data JSONB NOT NULL
    )
  `);
  analysesTableReady = true;
}

export async function saveAnalysis(data: Record<string, unknown>): Promise<void> {
  await ensureAnalysesTable();
  const position = data.position as Record<string, unknown> | undefined;
  const userInput = (position?.userInput as string) ?? "";
  const countryCode = (position?.countryCode as string) ?? null;
  const sailingArea = (position?.sailingArea as Record<string, unknown>)?.name_de as string ?? null;
  const city = (position?.city as Record<string, unknown>)?.name_de as string ?? null;
  await pool.query(
    `INSERT INTO analyses (user_input, country_code, sailing_area, city, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [userInput, countryCode, sailingArea, city, JSON.stringify(data)],
  );
}
