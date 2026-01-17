import pg from "pg";
const { Pool } = pg;

// Railway (y otros PaaS) suelen requerir SSL.
// En local, muchos Postgres NO lo soportan. Por eso lo activamos solo en producción.
const isProd = process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false
});

export async function query(text, params) {
  return pool.query(text, params);
}
