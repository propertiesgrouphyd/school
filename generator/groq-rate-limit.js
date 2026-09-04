import { setTimeout as sleep } from "node:timers/promises";

const MAX_RETRIES = 20;
const SAFETY_MS = 1000;

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseReset(value) {
  if (!value) return 0;

  const text = String(value).trim();

  if (/^\d+(?:\.\d+)?ms$/.test(text)) {
    return Math.max(0, number(text.slice(0, -2)));
  }

  const match = text.match(
    /^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/
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

function parseRetryAfter(value) {
  if (!value) return 0;

  const text = String(value).trim();

  const seconds = Number(text);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(text);

  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }

  return 0;
}

export async function waitForRateLimit(
  headers,
  reason = "rate limit",
  retryAfterMs = 0
) {
  const tokenReset = headers?.get("x-ratelimit-reset-tokens");
  const requestReset = headers?.get("x-ratelimit-reset-requests");

  const tokenMs = parseReset(tokenReset);
  const requestMs = parseReset(requestReset);

  /*
   * For an HTTP 429, Retry-After is authoritative when supplied.
   * Otherwise use the shortest positive reset window because the
   * exhausted resource may be tokens rather than requests.
   */
  let waitMs = retryAfterMs;

  if (waitMs <= 0) {
    const resets = [tokenMs, requestMs].filter(
      (value) => value > 0
    );

    waitMs = resets.length > 0
      ? Math.min(...resets)
      : 5000;
  }

  waitMs = Math.max(waitMs, 1000) + SAFETY_MS;

  console.log(
    `RATE LIMIT WAIT: ${reason} | ` +
    `tokens reset=${tokenReset ?? "unknown"} | ` +
    `requests reset=${requestReset ?? "unknown"} | ` +
    `waiting=${Math.ceil(waitMs / 1000)}s`
  );

  await sleep(waitMs);
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
        console.log(
          `HTTP 429 RATE LIMITED | ` +
          `attempt ${attempt}/${MAX_RETRIES}`
        );

        const retryAfterMs = parseRetryAfter(
          response.headers.get("retry-after")
        );

        await waitForRateLimit(
          response.headers,
          "HTTP 429",
          retryAfterMs
        );

        continue;
      }

      if (response.status >= 500 && response.status <= 599) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get("retry-after")
        );

        const waitMs = Math.max(
          retryAfterMs,
          Math.min(60000, 3000 * attempt)
        );

        console.log(
          `HTTP ${response.status} SERVER ERROR | ` +
          `attempt ${attempt}/${MAX_RETRIES} | ` +
          `waiting ${Math.ceil(waitMs / 1000)}s`
        );

        await sleep(waitMs);
        continue;
      }

      const body = await response.text();

      /*
       * Groq may return a complete JSON generation inside
       * failed_generation while reporting json_validate_failed.
       * Preserve that payload so the caller can parse and apply
       * its own authoritative validation.
       */
      if (
        response.status === 400 &&
        body.includes('"code":"json_validate_failed"') &&
        body.includes('"failed_generation"')
      ) {
        const recovered = new Response(
          body,
          {
            status: 200,
            headers: response.headers
          }
        );

        console.log(
          "GROQ JSON VALIDATION ERROR: recovered failed_generation payload"
        );

        return recovered;
      }

      throw new Error(
        `HTTP ${response.status}: ${body}`
      );
    } catch (error) {
      lastError = error;

      /*
       * Do not retry ordinary HTTP 4xx errors that are not rate
       * limits. They are normally permanent request/configuration
       * errors and should fail immediately.
       */
      if (
        error instanceof Error &&
        /^HTTP 4\d\d:/.test(error.message)
      ) {
        throw error;
      }

      if (attempt >= MAX_RETRIES) {
        break;
      }

      const waitMs = Math.min(
        60000,
        3000 * attempt
      );

      console.log(
        `NETWORK ERROR | ` +
        `attempt ${attempt}/${MAX_RETRIES} | ` +
        `retrying in ${Math.ceil(waitMs / 1000)}s`
      );

      await sleep(waitMs);
    }
  }

  throw (
    lastError ||
    new Error("Groq request failed after retries")
  );
}

export function getRateLimitState(headers) {
  return {
    tokenLimit: number(
      headers.get("x-ratelimit-limit-tokens")
    ),
    tokenRemaining: number(
      headers.get("x-ratelimit-remaining-tokens")
    ),
    requestLimit: number(
      headers.get("x-ratelimit-limit-requests")
    ),
    requestRemaining: number(
      headers.get("x-ratelimit-remaining-requests")
    ),
    tokenReset: headers.get(
      "x-ratelimit-reset-tokens"
    ),
    requestReset: headers.get(
      "x-ratelimit-reset-requests"
    )
  };
}
