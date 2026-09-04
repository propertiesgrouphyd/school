import fs from "fs";
import path from "path";

const dayNumber = Number(process.argv[2]);

if (!Number.isInteger(dayNumber) || dayNumber < 1) {
  console.error("Usage: node generator/generate-day.js <day-number>");
  process.exit(1);
}

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.error("GROQ_API_KEY is not set.");
  console.error("Set it in the server environment before generation.");
  process.exit(1);
}

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

const contentSchema = JSON.parse(
  fs.readFileSync("config/daily-content-schema.json", "utf8")
);

delete contentSchema.$schema;

const day = manifest.days?.find(
  item => Number(item.day) === dayNumber
);

if (!day) {
  console.error(`Day ${dayNumber} not found in manifest.`);
  process.exit(1);
}

const outputDirectory = config.output_directory;

fs.mkdirSync(outputDirectory, {
  recursive: true
});

const outputPath = path.join(
  outputDirectory,
  `day-${String(dayNumber).padStart(3, "0")}.json`
);

if (fs.existsSync(outputPath)) {
  console.error(`Output already exists: ${outputPath}`);
  console.error("Refusing to overwrite existing content.");
  process.exit(1);
}

const userPrompt = {
  task: "Generate the complete educational content and MCQ bank for this study day.",
  day: day.day,
  learning_point_count: day.learning_point_count,
  curriculum: day.curriculum,
  required_output_structure: {
    day: "number",
    title: "string",
    curriculum: "exact supplied curriculum array",
    lessons: "one lesson for every learning_unit_id",
    mcqs: "substantial MCQ bank covering the complete supplied curriculum"
  }
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
      schema: contentSchema
    }
  }
};

console.log(`Generating Day ${dayNumber}...`);
console.log(`Learning units: ${day.curriculum.length}`);
console.log(`Learning points: ${day.learning_point_count}`);
console.log(`Model: ${config.model}`);

let response;

try {
  response = await fetch(config.api_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000)
  });
} catch (error) {
  console.error("Groq request failed.");
  console.error(error.message);
  process.exit(1);
}

const responseText = await response.text();

if (!response.ok) {
  console.error(`Groq HTTP ${response.status}`);
  console.error(responseText.slice(0, 5000));
  process.exit(1);
}

let apiResponse;

try {
  apiResponse = JSON.parse(responseText);
} catch {
  console.error("Groq returned invalid API JSON.");
  process.exit(1);
}

const generatedText =
  apiResponse?.choices?.[0]?.message?.content;

if (!generatedText) {
  console.error("Groq response contains no generated content.");
  process.exit(1);
}

let generated;

try {
  generated = JSON.parse(generatedText);
} catch (error) {
  console.error("Groq generated content is not valid JSON.");
  console.error(error.message);
  process.exit(1);
}

const temporaryPath = `${outputPath}.tmp`;

fs.writeFileSync(
  temporaryPath,
  JSON.stringify(generated, null, 2),
  "utf8"
);

console.log("AI JSON received.");
console.log("Running strict syllabus validation...");

const validator = path.resolve(
  "scripts/validate-day-file.js"
);

const validationProcess = await import("child_process");

const result = validationProcess.spawnSync(
  process.execPath,
  [validator, temporaryPath],
  {
    stdio: "inherit"
  }
);

if (result.status !== 0) {
  fs.unlinkSync(temporaryPath);
  console.error("VALIDATION FAILED.");
  console.error("AI output was rejected and deleted.");
  process.exit(1);
}

fs.renameSync(temporaryPath, outputPath);

console.log(`Validated and saved: ${outputPath}`);
console.log("GENERATION COMPLETE");
