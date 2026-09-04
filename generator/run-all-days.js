import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const ROOT = process.cwd();

const manifestPath = path.join(
  ROOT,
  "data",
  "daily-manifest.json"
);

const manifestRaw = JSON.parse(
  fs.readFileSync(manifestPath, "utf8")
);

const days = Array.isArray(manifestRaw)
  ? manifestRaw
  : manifestRaw.days;

if (!Array.isArray(days) || days.length === 0) {
  throw new Error("Invalid daily manifest");
}

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.error("GROQ_API_KEY IS NOT SET");
  process.exit(1);
}

function batchDirectory(dayNumber) {
  return path.join(
    ROOT,
    "data",
    "batches",
    `day-${String(dayNumber).padStart(3, "0")}`
  );
}

function batchFile(dayNumber, batchNumber) {
  return path.join(
    batchDirectory(dayNumber),
    `DAY-${String(dayNumber).padStart(3, "0")}-BATCH-${String(
      batchNumber
    ).padStart(4, "0")}.json`
  );
}

function queueFile(dayNumber) {
  return path.join(
    ROOT,
    "data",
    "mcq-queue",
    `day-${String(dayNumber).padStart(3, "0")}.json`
  );
}

function runDay(dayNumber) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(
          ROOT,
          "generator",
          "run-mcq-day.js"
        ),
        String(dayNumber)
      ],
      {
        cwd: ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          GROQ_API_KEY: apiKey
        }
      }
    );

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Day ${dayNumber} runner exited with code ${code}`
          )
        );
      }
    });
  });
}

function getQueue(dayNumber) {
  const file = queueFile(dayNumber);

  if (!fs.existsSync(file)) {
    throw new Error(
      `MCQ queue not found for Day ${dayNumber}: ${file}`
    );
  }

  const queue = JSON.parse(
    fs.readFileSync(file, "utf8")
  );

  if (!Array.isArray(queue.batches)) {
    throw new Error(
      `Invalid MCQ queue for Day ${dayNumber}`
    );
  }

  return queue;
}

console.log("==============================================");
console.log("VIDHWAAN SCHOOL — PRODUCTION MCQ GENERATION");
console.log("==============================================");
console.log(`TOTAL STUDY DAYS: ${days.length}`);
console.log(`MODEL: openai/gpt-oss-120b`);
console.log("");

let completedDays = 0;
let skippedDays = 0;

for (const day of days) {
  const dayNumber = Number(day.day);
  const queue = getQueue(dayNumber);

  fs.mkdirSync(
    batchDirectory(dayNumber),
    { recursive: true }
  );

  const totalBatches = queue.batches.length;

  const existingBatches = queue.batches.filter(
    (batch) =>
      fs.existsSync(
        batchFile(
          dayNumber,
          batch.batch_number
        )
      )
  ).length;

  if (existingBatches === totalBatches) {
    console.log(
      `DAY ${dayNumber}: ALL ${totalBatches} BATCHES ALREADY COMPLETE — SKIPPING`
    );
    skippedDays++;
    continue;
  }

  console.log("");
  console.log("==============================================");
  console.log(
    `DAY ${dayNumber}: ${existingBatches}/${totalBatches} BATCHES COMPLETE`
  );
  console.log("==============================================");
  console.log(
    `Remaining batches: ${totalBatches - existingBatches}`
  );
  console.log("");

  try {
    await runDay(dayNumber);

    const remaining = queue.batches.filter(
      (batch) =>
        !fs.existsSync(
          batchFile(
            dayNumber,
            batch.batch_number
          )
        )
    );

    if (remaining.length > 0) {
      throw new Error(
        `Day ${dayNumber} ended with ${remaining.length} missing batches`
      );
    }

    completedDays++;

    console.log("");
    console.log(
      `DAY ${dayNumber}: ALL ${totalBatches} BATCHES COMPLETE`
    );
  } catch (error) {
    console.error("");
    console.error("==============================================");
    console.error(
      `GENERATION STOPPED AT DAY ${dayNumber}`
    );
    console.error("==============================================");
    console.error(error.message);
    console.error("");
    console.error(
      "All completed batches are preserved."
    );
    console.error(
      "The next CI/CD run will resume from the first missing batch."
    );

    process.exit(1);
  }
}

console.log("");
console.log("==============================================");
console.log("PRODUCTION GENERATION SUMMARY");
console.log("==============================================");
console.log(`Days newly completed: ${completedDays}`);
console.log(`Days already complete: ${skippedDays}`);
console.log(`Total study days: ${days.length}`);
console.log("");
console.log(
  "ALL MCQ QUEUE BATCHES ARE COMPLETE"
);
