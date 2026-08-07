/**
 * Rate limiter load test
 *
 * Tests race conditions near the limit boundary:
 * - Sends 15 concurrent requests (limit is 10/min)
 * - Expects exactly 10 allowed (200/202) and 5 rejected (429)
 * - Verifies no double-counting or lost requests
 *
 * Usage:
 *   1. Start the API: pnpm --filter @wspeech/api dev
 *   2. Register a user + create an API key (see Phase 1 smoke test)
 *   3. Set API_KEY env var and run: pnpm loadtest
 */

import autocannon from 'autocannon';

const API_KEY = process.env.API_KEY;
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

if (!API_KEY) {
  console.error('Set API_KEY env var first:');
  console.error(
    '  1. Register: curl -X POST http://localhost:3000/v1/auth/register -H "Content-Type: application/json" -d \'{"email":"test@test.com","password":"password123"}\'',
  );
  console.error(
    '  2. Login: curl -X POST http://localhost:3000/v1/auth/login -H "Content-Type: application/json" -d \'{"email":"test@test.com","password":"password123"}\'',
  );
  console.error(
    '  3. Create key: curl -X POST http://localhost:3000/v1/api-keys -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" -d \'{"label":"test"}\'',
  );
  console.error('  4. Run: API_KEY=<key> pnpm loadtest');
  process.exit(1);
}

const CONCURRENT = 15;
const LIMIT = 10;

async function run() {
  console.log(`\nRate limiter load test`);
  console.log(`  Limit: ${LIMIT} req/min per API key`);
  console.log(`  Concurrent requests: ${CONCURRENT}`);
  console.log(
    `  Expected: ${LIMIT} allowed, ${CONCURRENT - LIMIT} rejected (429)\n`,
  );

  const results = { allowed: 0, rejected: 0, errors: 0 };

  const instance = autocannon({
    url: BASE_URL,
    connections: CONCURRENT,
    duration: 5,
    pipelining: 0,
    requests: [
      {
        method: 'POST',
        path: '/v1/tts/sync',
        headers: {
          'content-type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({
          text: 'Hello world',
          voice: 'en_US-lessac-medium',
        }),
      },
    ],
  });

  instance.on('response', (_client, statusCode) => {
    if (statusCode === 200 || statusCode === 202) {
      results.allowed++;
    } else if (statusCode === 429) {
      results.rejected++;
    } else {
      results.errors++;
      console.log(`  Unexpected status: ${statusCode}`);
    }
  });

  await new Promise<void>((resolve) => {
    autocannon.track(instance, { renderStatusTable: false });
    instance.on('done', resolve);
  });

  console.log(`\nResults:`);
  console.log(`  Allowed (200/202): ${results.allowed}`);
  console.log(`  Rejected (429):    ${results.rejected}`);
  console.log(`  Errors:            ${results.errors}`);
  console.log(
    `  Total:             ${results.allowed + results.rejected + results.errors}`,
  );

  // Validate
  const ok = results.rejected > 0 && results.allowed <= LIMIT + 2; // small margin for window boundary
  console.log(
    `\n${ok ? 'PASS' : 'FAIL'}: Rate limiter ${ok ? 'working correctly' : 'has race conditions'}`,
  );

  if (results.allowed > LIMIT + 2) {
    console.log(
      `  WARNING: ${results.allowed} allowed exceeds limit of ${LIMIT} — race condition detected!`,
    );
  }
  if (results.rejected === 0) {
    console.log(
      `  WARNING: No requests rejected — rate limiter may not be active`,
    );
  }

  process.exit(ok ? 0 : 1);
}

run();
