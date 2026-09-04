import { setTimeout as sleep } from "node:timers/promises";

const MAX_RETRIES = 5;
const MAX_NETWORK_RETRIES = 2;
const SAFETY_MS = 1500;
const DEFAULT_429_WAIT_MS = 5000;
const MAX_SERVER_WAIT_MS = 60000;

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseReset(value) {
  if (!value) return 0;

  const text = String(value).trim();

  if (/^\d+(?:\.\d+)?ms$/i.test(text)) {
    return Math.max(0, number(text.slice(0, -2)));
  }

  const match = text.match(
    /^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i
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

function getHeader(headers, name) {
  return headers?.get?.(name) ?? null;
}

function logRateLimitState(headers) {
  const limitRequests = getHeader(
    headers,
    "x-ratelimit-limit-requests"
  );

  const remainingRequests = getHeader(
    headers,
    "x-ratelimit-remaining-requests"
  );

  const resetRequests = getHeader(
    headers,
    "x-ratelimit-reset-requests"
  );

  const limitTokens = getHeader(
    headers,
    "x-ratelimit-limit-tokens"
  );

  const remainingTokens = getHeader(
    headers,
    "x-ratelimit-remaining-tokens"
  );

  const resetTokens = getHeader(
    headers,
    "x-ratelimit-reset-tokens"
  );

  console.log(
    `RATE LIMIT STATE | ` +
    `requests=${remainingRequests ?? "?"}/${limitRequests ?? "?"} ` +
    `reset=${resetRequests ?? "?"} | ` +
    `tokens=${remainingTokens ?? "?"}/${limitTokens ?? "?"} ` +
    `reset=${resetTokens ?? "?"}`
  );
}

export async function waitForRateLimit(
  headers,
  reason = "rate limit",
  retryAfterMs = 0
) {
  const tokenReset = getHeader(
    headers,
    "x-ratelimit-reset-tokens"
  );

  const requestReset = getHeader(
    headers,
    "x-ratelimit-reset-requests"
  );

  const tokenMs = parseReset(tokenReset);
  const requestMs = parseReset(requestReset);

  /*
   * Groq explicitly supplies Retry-After for 429 responses.
   * Prefer it when present because it directly tells us when
   * the rejected request should be retried.
   *
   * Otherwise use the shortest positive reset window.
   */
  let waitMs = retryAfterMs;

  if (waitMs <= 0) {
    const resets = [
      tokenMs,
      requestMs
    ].filter((value) => value > 0);

    waitMs =
      resets.length > 0
        ? Math.min(...resets)
        : DEFAULT_429_WAIT_MS;
  }

  waitMs = Math.max(waitMs, 1000) + SAFETY_MS;

  console.log(
    `RATE LIMIT WAIT: ${reason} | ` +
    `tokens reset=${tokenReset ?? "unknown"} | ` +
    `requests reset=${requestReset ?? "unknown"} | ` +
    `waiting=${Math.ceil(waitMs / 1000)}s`
  );

  logRateLimitState(headers);

  await sleep(waitMs);
}


async function readGroqError(response) {
  try {
    const text = await response.text();

    if (!text) {
      return {
        raw: "",
        message: ""
      };
    }

    try {
      const data = JSON.parse(text);
      return {
        raw: text,
        message: String(data?.error?.message ?? "")
      };
    } catch {
      return {
        raw: text,
        message: text
      };
    }
  } catch {
    return {
      raw: "",
      message: ""
    };
  }
}

function parseGroqRetryWindow(message) {
  const match = String(message).match(
    /try again in\s+([0-9.]+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)/i
  );

  if (!match) return 0;

  const value = Number(match[1]);

  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  const unit = match[2].toLowerCase();

  if (
    unit.startsWith("hour") ||
    unit === "h"
  ) {
    return value * 60 * 60 * 1000;
  }

  if (
    unit.startsWith("minute") ||
    unit.startsWith("min") ||
    unit === "m"
  ) {
    return value * 60 * 1000;
  }

  return value * 1000;
}

function isTpdLimit(message) {
  const text = String(message).toLowerCase();

  return (
    text.includes("tokens per day") ||
    text.includes("(tpd)")
  );
}

async function handleRateLimitResponse(response, attempt) {
  const retryAfterMs = parseRetryAfter(
    response.headers.get("retry-after")
  );

  const error = await readGroqError(response);

  console.log(
    `HTTP 429 RATE LIMITED | ` +
    `attempt ${attempt}/${MAX_RETRIES}`
  );

  if (error.raw) {
    console.log(
      `GROQ 429 RESPONSE: ${error.raw}`
    );
  }

  const tpd = isTpdLimit(error.message);

  if (tpd) {
    const groqRetryMs = parseGroqRetryWindow(
      error.message
    );

    const waitMs =
      groqRetryMs > 0
        ? groqRetryMs
        : retryAfterMs;

    console.log(
      `TPD RATE LIMIT | ` +
      `waiting=${Math.ceil(waitMs / 1000)}s`
    );

    await waitForRateLimit(
      response.headers,
      "HTTP 429 TPD",
      waitMs
    );

    return "tpd";
  }

  await waitForRateLimit(
    response.headers,
    "HTTP 429",
    retryAfterMs
  );

  return "rate_limit";
}

export async function fetchWithRetry(url, options) {
  let lastError = null;
  let networkRetries = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let response;

    /*
     * Keep the fetch itself isolated from rate-limit handling.
     * This prevents a rate-limit wait/exception from being
     * incorrectly classified as a NETWORK ERROR.
     */
    try {
      response = await fetch(url, options);
    } catch (error) {
      lastError = error;
      networkRetries++;

      if (networkRetries > MAX_NETWORK_RETRIES) {
        break;
      }

      const waitMs = Math.min(
        MAX_SERVER_WAIT_MS,
        3000 * attempt
      );

      console.log(
        `NETWORK ERROR | ` +
        `attempt ${attempt}/${MAX_RETRIES} | ` +
        `${error?.name ?? "Error"}: ${error?.message ?? error} | ` +
        `retrying in ${Math.ceil(waitMs / 1000)}s`
      );

      await sleep(waitMs);
      continue;
    }

    /*
     * Successful response.
     */
    if (response.ok) {
      return response;
    }

    /*
     * 429 has its own dedicated path.
     *
     * IMPORTANT:
     * Do not throw it into the generic catch block.
     */
    if (response.status === 429) {
      await handleRateLimitResponse(
        response,
        attempt
      );

      continue;
    }

    /*
     * Retry transient 5xx errors.
     */
    if (
      response.status >= 500 &&
      response.status <= 599
    ) {
      const retryAfterMs = parseRetryAfter(
        response.headers.get("retry-after")
      );

      const waitMs = Math.max(
        retryAfterMs,
        Math.min(
          MAX_SERVER_WAIT_MS,
          3000 * attempt
        )
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
     * Groq can return a complete generation inside
     * failed_generation together with json_validate_failed.
     * Preserve that payload for local/authoritative validation.
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

    /*
     * Ordinary 4xx errors are not retryable.
     */
    throw new Error(
      `HTTP ${response.status}: ${body}`
    );
  }

  throw (
    lastError ||
    new Error(
      `Groq request failed after ${MAX_RETRIES} attempts`
    )
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
