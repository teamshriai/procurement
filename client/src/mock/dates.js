// Date helpers. The server used Postgres current_date / now(); in the browser these use local time.

export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today as YYYY-MM-DD (local). */
export const today = () => ymd(new Date());

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp. */
export const dateOf = (iso) => ymd(new Date(iso));

/** The date `n` days from today as YYYY-MM-DD (negative = past). */
export const isoDate = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

const utc = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole days from date b to date a (a - b), both YYYY-MM-DD. */
export const diffDays = (a, b) => Math.round((utc(a) - utc(b)) / 864e5);

export const nowIso = () => new Date().toISOString();

/** Accepts a Date, ISO string or nothing (= now) and returns an ISO string. */
export const toIso = (v) => (v ? new Date(v).toISOString() : nowIso());
