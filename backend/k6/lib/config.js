// Configuration as data: everything comes from the environment (k6 exposes it as __ENV).
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:5080';
// The tenant time zone as a fixed UTC offset in hours (Asia/Ho_Chi_Minh has no DST), used to pick "today".
export const SEED_UTC_OFFSET_HOURS = Number(__ENV.SEED_UTC_OFFSET_HOURS || 7);

export function required(name) {
  const value = __ENV[name];
  if (!value) throw new Error(`set ${name}`);
  return value;
}

/** YYYY-MM-DD for today + offset days in the tenant time zone. */
export function day(offset) {
  const ms = Date.now() + SEED_UTC_OFFSET_HOURS * 3600e3 + offset * 86400e3;
  return new Date(ms).toISOString().slice(0, 10);
}
