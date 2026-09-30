import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Return NUMERIC columns as JS numbers instead of strings
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// Return BIGINT (count(*)) as numbers
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// Keep DATE columns as plain 'YYYY-MM-DD' strings (avoid timezone shifts)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const query = (text, params) => pool.query(text, params);

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
