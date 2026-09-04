import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fetchWithRetry, getRateLimitState } from "./groq-rate-limit.js";

const require = createRequire(import.meta.url);

const {
  loadProgress,
  markStarted,
  markBatchCompleted,
  markFailure,
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

const SCHEMA = JSON.parse(
  fs.readFileSync(path.join(ROOT, "config/mcq-batch-schema.json"), "utf8")
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
  const remainingTokens = Number(
    getHeader(headers, "x-ratelimit-remaining-tokens")
  );

  const remainingRequests = Number(
    getHeader(headers, "x-ratelimit-remaining-requests")
  );

  if (
    Number.isFinite(remainingTokens) &&
    remainingTokens <=
      CONFIG.rate_limits.tokens_per_minute -
        CONFIG.rate_limits.safe_tokens_per_minute
  ) {
    const reset = parseResetDuration(
      getHeader(headers, "x-ratelimit-reset-tokens")
    );

    const wait = reset + 500;

    console.log(
      `TOKEN QUOTA LOW: ${remainingTokens} remaining`
    );

    console.log(
      `WAITING ${Math.ceil(wait / 1000)} seconds for token reset`
    );

    await sleep(wait);
  }

  if (Number.isFinite(remainingRequests) && remainingRequests <= 2) {
    const reset = parseResetDuration(
      getHeader(headers, "x-ratelimit-reset-requests")
    );

    const wait = reset + 500;

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

function buildPrompt(batch) {
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

ASSIGNED MCQ JOBS FOR THIS BATCH:
${curriculum}

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
21. Do not generate an MCQ for any job not supplied above.
22. Do not omit any supplied job.
23. Return ONLY valid JSON matching the supplied schema.
24. Do not return Markdown.
25. Do not return commentary.
26. Do not return a partial batch.
27. Complete every supplied job before returning JSON.

Return exactly one complete MCQ for each supplied job.
Return complete JSON only.

JSON schema:
${JSON.stringify(SCHEMA)}
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

  console.log("");
  console.log("=".repeat(60));
  console.log(`DAY: ${DAY}`);
  console.log(`BATCH: ${batchNumber}`);
  console.log(`BATCH ID: ${batchId}`);
  console.log("=".repeat(60));

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
            content: buildPrompt(queueBatch)
          }
        ],
        temperature: GROQ_CONFIG.temperature,
        max_tokens: CONFIG.generation.batch_max_output_tokens,
        include_reasoning: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "vidhwaan_mcq_batch",
            strict: true,
            schema: SCHEMA
          }
        }
      }),
      signal: AbortSignal.timeout(180000)
    }
  );

  await waitForQuota(response.headers);

  if (response.status === 429) {
    const retryAfter = getHeader(response.headers, "retry-after");

    const wait =
      retryAfter && !Number.isNaN(Number(retryAfter))
        ? Number(retryAfter) * 1000 + 1000
        : Math.min(60000, 2000 * Math.pow(2, retryCount));

    console.log(
      `RATE LIMITED (429). Waiting ${Math.ceil(wait / 1000)} seconds...`
    );

    const retryProgress = loadProgress();
    markRetry(retryProgress);

    await sleep(wait);

    return requestBatch(batchNumber, retryCount + 1);
  }

  if (response.status >= 500) {
    const wait = Math.min(
      60000,
      2000 * Math.pow(2, retryCount)
    );

    console.log(
      `SERVER ERROR ${response.status}. Retrying in ${Math.ceil(
        wait / 1000
      )} seconds...`
    );

    await sleep(wait);

    return requestBatch(batchNumber, retryCount + 1);
  }

  const rateState = getRateLimitState(response.headers);
console.log(
  `RATE STATUS: tokens ${rateState.tokenRemaining}/${rateState.tokenLimit} | ` +
  `requests ${rateState.requestRemaining}/${rateState.requestLimit}`
);

if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Groq HTTP ${response.status}: ${body}`
    );
  }

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
    data.batch_id = batchId;
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

  const validator = await new Promise((resolve) => {
    const child = require("child_process").spawn(
      process.execPath,
      [
        path.join(ROOT, "scripts/validate-mcq-batch.js"),
        tempPath
      ],
      {
        cwd: ROOT,
        stdio: "inherit"
      }
    );

    child.on("close", (code) => resolve(code));
  });

  if (validator !== 0) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    throw new Error(
      "MCQ BATCH REJECTED BY AUTHORITATIVE VALIDATOR"
    );
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
