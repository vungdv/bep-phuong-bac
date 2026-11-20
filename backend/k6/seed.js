// Seeds sample orders for yesterday, today and tomorrow (development only). Idempotent.
// Run: k6 run k6/seed.js   Env: BASE_URL, SCRIPT_CLIENT_SECRET (required), SEED_UTC_OFFSET_HOURS (default 7).
import { seedOrders } from './lib/seed.js';

export const options = { vus: 1, iterations: 1, thresholds: {} };

export default function () {
  const seeded = seedOrders();
  console.log(seeded.length ? `seeded ${seeded.join(', ')}` : 'nothing to seed (every day already has orders)');
}
