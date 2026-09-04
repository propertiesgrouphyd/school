import { setTimeout as sleep } from "node:timers/promises";

const MAX_RETRIES = 20;
const SAFETY_MS = 150;

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function waitForRateLimit(headers, reason = "rate limit") {
  const tokenReset = headers?.get("x-ratelimit-reset-tokens");
  const requestReset = headers?.get("x-ratelimit-reset-requests");

  const tokenMs = parseReset(tokenReset);
  const requestMs = parseReset(requestReset);

  const waitMs = Math.max(tokenMs, requestMs, 1000) + SAFETY_MS;

  console.log(
    `RATE LIMIT WAIT: ${reason} | ` +
    `tokens reset=${tokenReset ?? "unknown"} | ` +
    `requests reset=${requestReset ?? "unknown"} | ` +
    `waiting=${Math.ceil(waitMs / 1000)}s`
  );

  await sleep(waitMs);
}

function parseReset(value) {
  if (!value) return 0;

  const text = String(value).trim();

  if (/^\\d+(?:\\.\\d+)?ms$/.test(text)) {
    return Math.max(0, number(text.slice(0, -2)));
  }

  const match = text.match(
    /^(?:(\\d+(?:\\.\\d+)?)m)?(?:(\\d+(?:\\.\\d+)?)s)?$/
  );

  if (match && (match[1] !== undefined || match[2] !== undefined)) {
    const minutes = match[1] ? number(match[1]) : 0;
    const seconds = match[2] ? number(match[2]) : 0;

    return Math.max(
      0,
      minutes * 60000 + seconds * 1000
    );
  }

  const n = number(text);
  return n > 0 ? n * 1000 : 0;
}

export async function fetchWithRetry(url, options) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) {
        return response;
      }

      if (response.status === 429) {
        console.log(`HTTP 429 RATE LIMITED | attempt ${attempt}/${MAX_RETRIES}`);
        await waitForRateLimit(response.headers, "HTTP 429");
        continue;
      }

      if (response.status >= 500 && response.status <= 599) {
        const retryAfter = response.headers.get("retry-after");

        let waitMs = 2000 * attempt;

        if (retryAfter) {
          const seconds = Number(retryAfter);
          if (Number.isFinite(seconds)) {
            waitMs = Math.max(waitMs, seconds * 1000);
          }
        }

        console.log(
          `HTTP ${response.status} SERVER ERROR | ` +
          `attempt ${attempt}/${MAX_RETRIES} | waiting ${Math.ceil(waitMs / 1000)}s`
        );

        await sleep(waitMs);
        continue;
      }

      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body}`);
    } catch (error) {
      lastError = error;

      if (attempt >= MAX_RETRIES) {
        break;
      }

      const waitMs = Math.min(30000, 2000 * attempt);

      console.log(
        `NETWORK ERROR | attempt ${attempt}/${MAX_RETRIES} | ` +
        `retrying in ${Math.ceil(waitMs / 1000)}s`
      );

      await sleep(waitMs);
    }
  }

  throw lastError || new Error("Groq request failed after retries");
}

export function getRateLimitState(headers) {
  return {
    tokenLimit: number(headers.get("x-ratelimit-limit-tokens")),
    tokenRemaining: number(headers.get("x-ratelimit-remaining-tokens")),
    requestLimit: number(headers.get("x-ratelimit-limit-requests")),
    requestRemaining: number(headers.get("x-ratelimit-remaining-requests")),
    tokenReset: headers.get("x-ratelimit-reset-tokens"),
    requestReset: headers.get("x-ratelimit-reset-requests")
  };
}
