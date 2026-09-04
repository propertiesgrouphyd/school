import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const config = JSON.parse(
  fs.readFileSync("config/groq-config.json", "utf8")
);

const manifest = JSON.parse(
  fs.readFileSync(config.source_manifest, "utf8")
);

const systemPrompt = fs.readFileSync(
  "config/groq-system-prompt.txt",
  "utf8"
);

const schema = JSON.parse(
  fs.readFileSync("config/daily-content-schema.json", "utf8")
);

delete schema.$schema;

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.error("GROQ_API_KEY IS NOT SET");
  process.exit(1);
}

const outputDirectory = config.output_directory;
fs.mkdirSync(outputDirectory, { recursive: true });

const MAX_RETRIES = 8;
const BASE_WAIT_MS = 5000;
const MAX_WAIT_MS = 300000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function outputPath(dayNumber) {
  return path.join(
    outputDirectory,
    `day-${String(dayNumber).padStart(3, "0")}.json`
  );
}

function validate(file) {
  const result = spawnSync(
    process.execPath,
    ["scripts/validate-day-file.js", file],
    { stdio: "inherit" }
  );

  return result.status === 0;
}

async function generateDay(day) {
  const finalPath = outputPath(day.day);
  const tempPath = `${finalPath}.tmp`;

  if (fs.existsSync(finalPath)) {
    console.log(`Day ${day.day}: already complete — skipping`);
    return "skipped";
  }

  const userPrompt = {
    task: "Generate complete educational content and a substantial MCQ bank for exactly this study day.",
    day: day.day,
    learning_point_count: day.learning_point_count,
    curriculum: day.curriculum,
    requirements: [
      "Cover every curriculum item.",
      "Cover every learning point.",
      "Create exactly one lesson for every learning_unit_id.",
      "Generate a substantial number of high-quality MCQs.",
      "Every MCQ must have exactly four options A, B, C and D.",
      "Every MCQ must have exactly one correct answer.",
      "Every MCQ must have a clear teaching explanation.",
      "Every MCQ must reference a valid learning_unit_id.",
      "Return only JSON matching the supplied schema."
    ]
  };

  const body = {
    model: config.model,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: JSON.stringify(userPrompt)
      }
    ],
    temperature: config.temperature,
    max_tokens: config.max_tokens,
    include_reasoning: false,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "vidhwaan_daily_content",
        strict: true,
        schema
      }
    }
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(
      `Day ${day.day}: request attempt ${attempt}/${MAX_RETRIES}`
    );

    let response;

    try {
      response = await fetch(config.api_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000)
      });
    } catch (error) {
      const wait = Math.min(
        BASE_WAIT_MS * 2 ** (attempt - 1),
        MAX_WAIT_MS
      );

      console.error(
        `Day ${day.day}: network error — waiting ${Math.ceil(wait / 1000)}s`
      );

      if (attempt === MAX_RETRIES) throw error;

      await sleep(wait);
      continue;
    }

    const text = await response.text();

    if (response.ok) {
      let apiData;

      try {
        apiData = JSON.parse(text);
      } catch {
        console.error(`Day ${day.day}: invalid API JSON`);
        continue;
      }

      const generatedText =
        apiData?.choices?.[0]?.message?.content;

      if (!generatedText) {
        console.error(`Day ${day.day}: empty model content`);
        continue;
      }

      let generated;

      try {
        generated = JSON.parse(generatedText);
      } catch {
        console.error(`Day ${day.day}: model returned invalid JSON`);
        continue;
      }

      fs.writeFileSync(
        tempPath,
        JSON.stringify(generated, null, 2),
        "utf8"
      );

      console.log(`Day ${day.day}: validating...`);

      if (!validate(tempPath)) {
        fs.unlinkSync(tempPath);
        console.error(
          `Day ${day.day}: validation failed — output rejected`
        );
        return "failed";
      }

      fs.renameSync(tempPath, finalPath);

      console.log(
        `Day ${day.day}: COMPLETE`
      );

      return "complete";
    }

    if (response.status === 429) {
      const retryAfter =
        Number(response.headers.get("retry-after")) || 0;

      const wait =
        retryAfter > 0
          ? retryAfter * 1000
          : Math.min(
              BASE_WAIT_MS * 2 ** (attempt - 1),
              MAX_WAIT_MS
            );

      console.log(
        `Day ${day.day}: rate limit reached — waiting ${Math.ceil(wait / 1000)}s`
      );

      if (attempt === MAX_RETRIES) {
        console.error(
          `Day ${day.day}: maximum retries reached`
        );
        return "failed";
      }

      await sleep(wait);
      continue;
    }

    if ([408, 409, 500, 502, 503, 504].includes(response.status)) {
      const wait = Math.min(
        BASE_WAIT_MS * 2 ** (attempt - 1),
        MAX_WAIT_MS
      );

      console.error(
        `Day ${day.day}: HTTP ${response.status} — waiting ${Math.ceil(wait / 1000)}s`
      );

      if (attempt === MAX_RETRIES) {
        console.error(
          `Day ${day.day}: maximum retries reached`
        );
        return "failed";
      }

      await sleep(wait);
      continue;
    }

    console.error(
      `Day ${day.day}: HTTP ${response.status}`
    );
    console.error(text.slice(0, 3000));

    return "failed";
  }

  return "failed";
}

let completed = 0;
let skipped = 0;
let failed = 0;

console.log("========================================");
console.log("VIDHWAAN SCHOOL FULL GENERATION");
console.log("========================================");
console.log(`Model: ${config.model}`);
console.log(`Total days: ${manifest.days.length}`);
console.log("");

for (const day of manifest.days) {
  const result = await generateDay(day);

  if (result === "complete") completed++;
  if (result === "skipped") skipped++;

  if (result === "failed") {
    failed++;
    console.error(
      `STOPPED at Day ${day.day}. Completed output is preserved.`
    );
    break;
  }
}

console.log("");
console.log("========================================");
console.log("GENERATION SUMMARY");
console.log("========================================");
console.log(`New days completed: ${completed}`);
console.log(`Existing days skipped: ${skipped}`);
console.log(`Failed days: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

console.log("ALL REQUESTED DAYS COMPLETE");
