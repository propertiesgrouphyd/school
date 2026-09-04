import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fetchWithRetry, getRateLimitState } from "./groq-rate-limit.js";

const require = createRequire(import.meta.url);

const {
  loadProgress,
  markStarted,
  markBatchCompleted,
  markRetry
} = await import("./progress.js");

const ROOT = process.cwd();

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(ROOT, "config/generation-plan.json"), "utf8")
);

const GROQ_CONFIG = JSON.parse(
  fs.readFileSync(path.join(ROOT, "config/groq-config.json"), "utf8")
);

const MANIFEST_RAW = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "data/daily-manifest.json"),
    "utf8"
  )
);

const MANIFEST = Array.isArray(MANIFEST_RAW)
  ? MANIFEST_RAW
  : MANIFEST_RAW.days;

const BASE_SCHEMA = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "config/mcq-batch-schema.json"),
    "utf8"
  )
);

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(ROOT, "config/groq-system-prompt.txt"),
  "utf8"
);

const API_KEY = process.env.GROQ_API_KEY;

if (!API_KEY) {
  throw new Error("GROQ_API_KEY is not set");
}

const DAY = Number(process.argv[2]);
const REQUESTED_BATCH = process.argv[3] ? Number(process.argv[3]) : null;

if (!Number.isInteger(DAY) || DAY < 1) {
  throw new Error("Usage: node generator/generate-mcq-batch.js <day>");
}

const dayData = MANIFEST.find((d) => d.day === DAY);

if (!dayData) {
  throw new Error(`Day ${DAY} not found in daily manifest`);
}

const QUEUE_FILE = path.join(
  ROOT,
  "data",
  "mcq-queue",
  `day-${String(DAY).padStart(3, "0")}.json`
);

if (!fs.existsSync(QUEUE_FILE)) {
  throw new Error(`MCQ queue not found: ${QUEUE_FILE}`);
}

const QUEUE = JSON.parse(
  fs.readFileSync(QUEUE_FILE, "utf8")
);

if (!Array.isArray(QUEUE.batches)) {
  throw new Error(`Invalid MCQ queue for Day ${DAY}`);
}

const batchDirectory = path.join(
  ROOT,
  CONFIG.storage.batch_directory,
  `day-${String(DAY).padStart(3, "0")}`
);

fs.mkdirSync(batchDirectory, { recursive: true });

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const QUOTA_STATE_FILE = path.join(
  ROOT,
  "data",
  "groq-quota-state.json"
);

function saveQuotaState(headers) {
  if (!headers) return;

  const now = Date.now();

  const tokenReset = getHeader(
    headers,
    "x-ratelimit-reset-tokens"
  );

  const requestReset = getHeader(
    headers,
    "x-ratelimit-reset-requests"
  );

  const parseResetMs = (value) => {
    if (!value) return null;

    const match = String(value).trim().match(
      /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/
    );

    if (!match) return null;

    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);

    return (
      hours * 60 * 60 * 1000 +
      minutes * 60 * 1000 +
      seconds * 1000
    );
  };

  const tokenResetMs = parseResetMs(tokenReset);
  const requestResetMs = parseResetMs(requestReset);

  const state = {
    updated_at: new Date(now).toISOString(),

    token_limit: getHeader(
      headers,
      "x-ratelimit-limit-tokens"
    ),

    token_remaining: getHeader(
      headers,
      "x-ratelimit-remaining-tokens"
    ),

    token_reset_at:
      tokenResetMs === null
        ? null
        : new Date(now + tokenResetMs).toISOString(),

    request_limit: getHeader(
      headers,
      "x-ratelimit-limit-requests"
    ),

    request_remaining: getHeader(
      headers,
      "x-ratelimit-remaining-requests"
    ),

    request_reset_at:
      requestResetMs === null
        ? null
        : new Date(now + requestResetMs).toISOString()
  };

  const tempFile = `${QUOTA_STATE_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(state, null, 2) + "\n",
    "utf8"
  );

  fs.renameSync(tempFile, QUOTA_STATE_FILE);
}

function loadQuotaState() {
  if (!fs.existsSync(QUOTA_STATE_FILE)) {
    return null;
  }

  try {
    const state = JSON.parse(
      fs.readFileSync(QUOTA_STATE_FILE, "utf8")
    );

    const now = Date.now();

    const remainingDuration = (resetAt) => {
      if (!resetAt) return null;

      const resetTime = Date.parse(resetAt);

      if (!Number.isFinite(resetTime)) {
        return null;
      }

      return Math.max(0, resetTime - now);
    };

    state.token_reset = remainingDuration(
      state.token_reset_at
    );

    state.request_reset = remainingDuration(
      state.request_reset_at
    );

    return state;
  } catch {
    return null;
  }
}

function parseResetDuration(value) {
  if (!value) return 1000;

  const text = String(value).trim();

  let total = 0;

  const minutes = text.match(/([\d.]+)m/);
  const seconds = text.match(/([\d.]+)s/);
  const milliseconds = text.match(/([\d.]+)ms/);

  if (minutes) total += Number(minutes[1]) * 60 * 1000;
  if (seconds) total += Number(seconds[1]) * 1000;
  if (milliseconds) total += Number(milliseconds[1]);

  return total > 0 ? Math.ceil(total) : 1000;
}

function getHeader(headers, name) {
  return (
    headers.get(name) ||
    headers.get(name.toLowerCase()) ||
    headers.get(name.toUpperCase()) ||
    null
  );
}

async function waitForQuota(headers) {
  if (!headers) {
    return;
  }

  const remainingTokens = Number(
    getHeader(headers, "x-ratelimit-remaining-tokens")
  );

  const remainingRequests = Number(
    getHeader(headers, "x-ratelimit-remaining-requests")
  );

  const safeTokenReserve =
    CONFIG.rate_limits.safe_tokens_per_minute;

  /*
   * Never start another request when the remaining token
   * capacity is below the safe reserve.
   */
  if (
    Number.isFinite(remainingTokens) &&
    remainingTokens < safeTokenReserve
  ) {
    const reset = parseResetDuration(
      getHeader(headers, "x-ratelimit-reset-tokens")
    );

    const wait = Math.max(reset, 1000) + 1000;

    console.log(
      `TOKEN QUOTA LOW: ${remainingTokens} remaining`
    );

    console.log(
      `WAITING ${Math.ceil(wait / 1000)} seconds for token reset`
    );

    await sleep(wait);
  }

  /*
   * The request limit is 1000/minute and is normally not
   * the limiting resource, but protect against exhaustion.
   */
  if (
    Number.isFinite(remainingRequests) &&
    remainingRequests <= 2
  ) {
    const reset = parseResetDuration(
      getHeader(headers, "x-ratelimit-reset-requests")
    );

    const wait = Math.max(reset, 1000) + 1000;

    console.log(
      `REQUEST QUOTA LOW: ${remainingRequests} remaining`
    );

    console.log(
      `WAITING ${Math.ceil(wait / 1000)} seconds for request reset`
    );

    await sleep(wait);
  }
}

function validateBatchStructure(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Response is not an object");
  }

  if (data.day !== DAY) {
    throw new Error(
      `Wrong day returned: expected ${DAY}, got ${data.day}`
    );
  }

  if (!data.batch_id) {
    throw new Error("Missing batch_id");
  }

  if (!Array.isArray(data.mcqs)) {
    throw new Error("mcqs must be an array");
  }

  if (data.mcqs.length === 0) {
    throw new Error("MCQ batch is empty");
  }

  for (const [index, mcq] of data.mcqs.entries()) {

    if (!Number.isInteger(mcq.job_number)) {
      throw new Error(
        `MCQ ${index + 1}: job_number must be an integer`
      );
    }

    if (
      ![
        "direct_concept",
        "conceptual_understanding",
        "definition_and_distinction",
        "application",
        "example_based",
        "scenario_based",
        "misconception_check",
        "reasoning",
        "comparison",
        "competitive_exam"
      ].includes(mcq.question_type)
    ) {
      throw new Error(
        `MCQ ${index + 1}: invalid question_type`
      );
    }

    const required = [
      "mcq_id",
      "learning_unit_id",
      "learning_point",
      "question",
      "options",
      "correct_option",
      "answer",
      "explanation",
      "difficulty"
    ];

    for (const field of required) {
      if (
        mcq[field] === undefined ||
        mcq[field] === null ||
        mcq[field] === ""
      ) {
        throw new Error(
          `MCQ ${index + 1}: missing ${field}`
        );
      }
    }

    if (
      !mcq.options ||
      typeof mcq.options !== "object" ||
      Array.isArray(mcq.options)
    ) {
      throw new Error(
        `MCQ ${index + 1}: invalid options`
      );
    }

    if (
      !["A", "B", "C", "D"].every(
        (key) =>
          typeof mcq.options[key] === "string" &&
          mcq.options[key].trim()
      )
    ) {
      throw new Error(
        `MCQ ${index + 1}: options A-D required`
      );
    }

    if (!["A", "B", "C", "D"].includes(mcq.correct_option)) {
      throw new Error(
        `MCQ ${index + 1}: invalid correct_option`
      );
    }

    const expectedAnswer = mcq.options[mcq.correct_option];

    const normalizeAnswer = (value) =>
      String(value)
        .replace(/\\s+/g, " ")
        .trim();

    if (
      normalizeAnswer(mcq.answer) !==
      normalizeAnswer(expectedAnswer)
    ) {
      throw new Error(
        `MCQ ${index + 1}: answer does not match correct option`
      );
    }

    if (
      !["easy", "medium", "hard"].includes(mcq.difficulty)
    ) {
      throw new Error(
        `MCQ ${index + 1}: invalid difficulty`
      );
    }
  }
}

function buildPrompt(batch, batchId) {
  const curriculum = JSON.stringify(
    batch.jobs,
    null,
    2
  );

  return `
Generate MCQs for Day ${DAY}.

THE FOLLOWING MCQ JOBS ARE AUTHORITATIVE.
Do not add, remove, rename, merge, replace, or invent any syllabus item.

DAY:
${DAY}

EXACT BATCH ID:
${batchId}

ASSIGNED MCQ JOBS FOR THIS BATCH:
${curriculum}

MANDATORY TOP-LEVEL OUTPUT:
{
  "day": ${DAY},
  "batch_id": "${batchId}",
  "mcqs": [...]
}

The value of "day" MUST be exactly ${DAY}.
The value of "batch_id" MUST be exactly "${batchId}".
Never use another day number or another batch ID.

Each job specifies exactly one MCQ to generate.

MCQ REQUIREMENTS:

1. Generate exactly one MCQ for every supplied job.
2. Generate no fewer and no more than the number of supplied jobs.
3. Every MCQ must use the exact learning_unit_id from its job.
4. Every MCQ must use the exact learning_point from its job.
5. Follow the exact question_type specified by the job.
6. Follow the exact difficulty specified by the job.
7. Questions must test genuine understanding, not word matching.
8. Questions must be meaningful and academically accurate.
9. Do not repeat the same question or merely change its wording.
10. Use clear, age-appropriate language while maintaining academic rigor.
11. For mathematics, calculations and reasoning must be correct.
12. For science, distinguish concepts, mechanisms, examples, causes,
    effects, applications, and misconceptions accurately.
13. For social science, distinguish facts, chronology, geography,
    governance, economics, causes, effects, and interpretation accurately.
14. For languages, test comprehension, grammar, vocabulary, interpretation,
    usage, and literary understanding where appropriate.
15. Every MCQ must have exactly four options: A, B, C, D.
16. Exactly one option must be correct.
17. The answer must exactly equal the correct option text.
18. Every explanation must teach the underlying concept.
19. Explanations should explain why the correct answer is correct and,
    where useful, why the other options are incorrect.
20. Do not introduce unrelated syllabus content.
21. Every MCQ MUST contain the exact job_number of its assigned job.
22. Every MCQ MUST contain the exact question_type of its assigned job.
23. Every MCQ object MUST contain these fields:
    job_number, question_type, mcq_id, learning_unit_id, learning_point,
    question, options, correct_option, answer, explanation, difficulty.
24. The options object MUST contain exactly A, B, C and D.
25. correct_option MUST be exactly one of A, B, C or D.
26. answer MUST exactly equal the text of the selected option.
27. Do not generate an MCQ for any job not supplied above.
28. Do not omit any supplied job.
29. Do not reuse a job_number.
30. Return ONLY valid JSON.
31. Do not return Markdown.
32. Do not return commentary.
33. Do not return a partial batch.
34. Complete every supplied job before returning JSON.
35. Return exactly one complete MCQ for each supplied job.
`;
}
async function requestBatch(batchNumber, retryCount = 0) {
  const queueBatch = QUEUE.batches.find(
    (batch) => batch.batch_number === batchNumber
  );

  if (!queueBatch) {
    throw new Error(
      `Queue batch ${batchNumber} not found for Day ${DAY}`
    );
  }

  const batchId = `DAY-${String(DAY).padStart(3, "0")}-BATCH-${String(
    batchNumber
  ).padStart(4, "0")}`;

  /*
   * The batch identity is enforced by the prompt and by the
   * authoritative validator below. JSON mode is deliberately
   * used instead of Groq Structured Outputs so a model-side
   * schema-generation failure cannot terminate the entire run.
   */
  const SCHEMA = JSON.parse(JSON.stringify(BASE_SCHEMA));

  console.log("");
  console.log("=".repeat(60));
  console.log(`DAY: ${DAY}`);
  console.log(`BATCH: ${batchNumber}`);
  console.log(`BATCH ID: ${batchId}`);
  console.log("=".repeat(60));

  /*
   * Wait BEFORE the next Groq request when the previous
   * batch left insufficient quota.
   *
   * The batch generator runs as a separate Node process for
   * every batch, so quota state must be persisted to disk.
   */
  const previousQuotaState = loadQuotaState();

  if (previousQuotaState) {
    const quotaHeaders = new Headers();

    if (previousQuotaState.token_limit !== null) {
      quotaHeaders.set(
        "x-ratelimit-limit-tokens",
        previousQuotaState.token_limit ?? ""
      );
    }

    if (previousQuotaState.token_remaining !== null) {
      quotaHeaders.set(
        "x-ratelimit-remaining-tokens",
        previousQuotaState.token_remaining ?? ""
      );
    }

    if (previousQuotaState.token_reset !== null) {
      quotaHeaders.set(
        "x-ratelimit-reset-tokens",
        previousQuotaState.token_reset ?? ""
      );
    }

    if (previousQuotaState.request_limit !== null) {
      quotaHeaders.set(
        "x-ratelimit-limit-requests",
        previousQuotaState.request_limit ?? ""
      );
    }

    if (previousQuotaState.request_remaining !== null) {
      quotaHeaders.set(
        "x-ratelimit-remaining-requests",
        previousQuotaState.request_remaining ?? ""
      );
    }

    if (previousQuotaState.request_reset !== null) {
      quotaHeaders.set(
        "x-ratelimit-reset-requests",
        previousQuotaState.request_reset ?? ""
      );
    }

    await waitForQuota(quotaHeaders);
  }

  const response = await fetchWithRetry(
    GROQ_CONFIG.api_url,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: CONFIG.model,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT
          },
          {
            role: "user",
            content: buildPrompt(queueBatch, batchId)
          }
        ],
        temperature: GROQ_CONFIG.temperature,
        max_tokens: CONFIG.generation.batch_max_output_tokens,
        include_reasoning: false,
        response_format: {
          type: "json_object"
        }
      }),
      signal: AbortSignal.timeout(900000)
    }
  );

  saveQuotaState(response.headers);

  const rateState = getRateLimitState(response.headers);
console.log(
  `RATE STATUS: tokens ${rateState.tokenRemaining}/${rateState.tokenLimit} | ` +
  `requests ${rateState.requestRemaining}/${rateState.requestLimit}`
);

  const payload = await response.json();

  if (
    !payload.choices ||
    !payload.choices[0] ||
    !payload.choices[0].message
  ) {
    throw new Error("Invalid Groq response");
  }

  const content = payload.choices[0].message.content;

  if (!content) {
    throw new Error("Groq returned empty content");
  }

  let data;

  try {
    data = JSON.parse(content);
  } catch {
    throw new Error("Groq returned invalid JSON");
  }

  try {
    validateBatchStructure(data);
  } catch (error) {
    console.error("");
    console.error(
      `BATCH CONTENT VALIDATION FAILED: ${error.message}`
    );
    console.error(
      "REJECTING MODEL OUTPUT AND REGENERATING THE SAME BATCH..."
    );

    const retryProgress = loadProgress();
    markRetry(retryProgress);

    if (retryCount >= 7) {
      throw new Error(
        `Batch ${batchId} failed content validation after ${retryCount + 1} attempts: ${error.message}`
      );
    }

    const wait = Math.min(
      15000,
      2000 * Math.pow(2, retryCount)
    );

    console.log(
      `CONTENT RETRY ${retryCount + 1}/8 — waiting ${Math.ceil(wait / 1000)}s`
    );

    await sleep(wait);

    return requestBatch(batchNumber, retryCount + 1);
  }

  if (data.batch_id !== batchId) {
    throw new Error(
      `Wrong batch_id returned: expected ${batchId}, got ${data.batch_id}`
    );
  }

  const outputPath = path.join(
    batchDirectory,
    `${batchId}.json`
  );

  const tempPath = `${outputPath}.tmp`;

  fs.writeFileSync(
    tempPath,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  console.log("RUNNING AUTHORITATIVE BATCH VALIDATOR...");

  /*
   * The authoritative validator requires the exact production filename.
   * Validate a temporary copy using that exact filename, then remove it.
   */
  const validationDirectory = fs.mkdtempSync(
    path.join(batchDirectory, ".validate-")
  );

  const validationPath = path.join(
    validationDirectory,
    path.basename(outputPath)
  );

  fs.copyFileSync(tempPath, validationPath);

  const validator = await new Promise((resolve) => {
    const child = require("child_process").spawn(
      process.execPath,
      [
        path.join(ROOT, "scripts/validate-mcq-batch.js"),
        validationPath
      ],
      {
        cwd: ROOT,
        stdio: "inherit"
      }
    );

    child.on("close", (code) => resolve(code));
  });

  fs.rmSync(validationDirectory, {
    recursive: true,
    force: true
  });

  if (validator !== 0) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    const retryProgress = loadProgress();
    markRetry(retryProgress);

    if (retryCount >= 7) {
      throw new Error(
        `MCQ batch ${batchId} failed authoritative validation after 8 attempts`
      );
    }

    const wait = Math.min(
      15000,
      2000 * Math.pow(2, retryCount)
    );

    console.error(
      `AUTHORITATIVE VALIDATION FAILED — ` +
      `REGENERATING ${batchId} ` +
      `(attempt ${retryCount + 2}/8)`
    );

    console.log(
      `VALIDATOR RETRY WAIT: ${Math.ceil(wait / 1000)}s`
    );

    await sleep(wait);

    return requestBatch(batchNumber, retryCount + 1);
  }

  fs.renameSync(tempPath, outputPath);

  const progress = loadProgress();
  markBatchCompleted(
    progress,
    DAY,
    batchId,
    data.mcqs.length
  );

  const usage = payload.usage || {};

  console.log("");
  console.log("BATCH SAVED");
  console.log(`FILE: ${outputPath}`);
  console.log(`MCQs: ${data.mcqs.length}`);

  if (usage.total_tokens !== undefined) {
    console.log(`TOKENS USED: ${usage.total_tokens}`);
  }

  const remainingTokens = getHeader(
    response.headers,
    "x-ratelimit-remaining-tokens"
  );

  if (remainingTokens) {
    console.log(`TOKENS REMAINING: ${remainingTokens}`);
  }

  console.log(`BATCH ${batchNumber} COMPLETE`);

  return data;
}

const progress = loadProgress();
markStarted(progress);

const existing = fs
  .readdirSync(batchDirectory)
  .filter(
    (file) =>
      file.endsWith(".json") &&
      file.startsWith(
        `DAY-${String(DAY).padStart(3, "0")}-BATCH-`
      )
  );

const completedBatchNumbers = new Set(
  existing
    .map((file) => {
      const match = file.match(/BATCH-(\\d+)\\.json$/);
      return match ? Number(match[1]) : null;
    })
    .filter((value) => Number.isInteger(value))
);

const nextBatch =
  REQUESTED_BATCH !== null
    ? REQUESTED_BATCH
    : (() => {
        for (const batch of QUEUE.batches) {
          if (!completedBatchNumbers.has(batch.batch_number)) {
            return batch.batch_number;
          }
        }
        return null;
      })();

console.log("VIDHWAAN MCQ BATCH GENERATOR");
console.log(`MODEL: ${CONFIG.model}`);
console.log(
  `TOKEN LIMIT: ${CONFIG.rate_limits.tokens_per_minute}/minute`
);
console.log(
  `SAFE TOKEN LIMIT: ${CONFIG.rate_limits.safe_tokens_per_minute}/minute`
);
console.log(
  `BATCH OUTPUT LIMIT: ${CONFIG.generation.batch_max_output_tokens}`
);
console.log(`DAY: ${DAY}`);
console.log(`EXISTING BATCHES: ${existing.length}`);
console.log(
  `REQUESTED BATCH: ${
    REQUESTED_BATCH === null ? "AUTO" : REQUESTED_BATCH
  }`
);

if (nextBatch === null) {
  console.log(`DAY ${DAY} ALL QUEUE BATCHES ALREADY COMPLETE`);
  process.exit(0);
}

if (completedBatchNumbers.has(nextBatch)) {
  console.log(`BATCH ${nextBatch} ALREADY COMPLETE`);
  process.exit(0);
}

console.log(`NEXT BATCH: ${nextBatch}`);

await requestBatch(nextBatch);
