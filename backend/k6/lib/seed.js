import http from 'k6/http';
import { BASE_URL, day } from './config.js';
import { JSON_HEADERS, bearer, graphql, scriptToken } from './auth.js';

// name, qty, message, hour, minute (same rows as apps/orders local-storage-orders-api.ts)
export const ROWS = [
  ['Nguyễn Văn An', 2, 'Ít cay, giao trước 11h'],
  ['Trần Thị Bích', 1, ''],
  ['Lê Hoàng Nam', 4, 'Thêm rau sống'],
  ['Phạm Thu Hà', 3, ''],
  ['Võ Minh Tuấn', 5, 'Gọi trước khi đến'],
  ['Đặng Ngọc Lan', 1, 'Không hành'],
];

function countFor(token, date) {
  // ServiceDate is a text field "YYYY-MM-DD"; equality works on PostgreSQL.
  const res = graphql(token, `{ order(where:{serviceDate:"${date}"}) { contentItemId } }`);
  return res.json('data.order').length;
}

/**
 * Seeds sample orders for yesterday, today and tomorrow through the public APIs. Idempotent: a day that
 * already has orders is skipped. Returns the list of days it seeded.
 */
export function seedOrders(token = scriptToken()) {
  const seeded = [];
  for (const offset of [-1, 0, 1]) {
    const date = day(offset);
    if (countFor(token, date) > 0) continue;
    ROWS.forEach(([name, qty, message], i) => {
      const no = i + 1;
      // only some of yesterday's orders are delivered (odd positions), like the front-end seed
      const delivered = offset === -1 && no % 2 === 1;
      const body = {
        ContentType: 'Order', DisplayText: `${date} #${no} ${name}`, Published: true, Latest: true,
        Order: {
          No: { Value: no }, CustomerName: { Text: name }, Qty: { Value: qty }, Message: { Text: message },
          ServiceDate: { Text: date }, Delivered: { Value: delivered },
        },
      };
      const res = http.post(`${BASE_URL}/api/content`, JSON.stringify(body), bearer(token, JSON_HEADERS));
      if (res.status !== 200) throw new Error(`seeding ${date} #${no} failed (HTTP ${res.status})`);
    });
    seeded.push(date);
  }
  return seeded;
}
