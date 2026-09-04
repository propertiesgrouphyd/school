import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const ROOT = process.cwd();

const DAY = Number(process.argv[2]);

if (!Number.isInteger(DAY) || DAY < 1) {
  throw new Error(
    "Usage: node generator/run-mcq-day.js <day>"
  );
}

const queueFile = path.join(
  ROOT,
  "data",
  "mcq-queue",
  `day-${String(DAY).padStart(3, "0")}.json`
);

if (!fs.existsSync(queueFile)) {
  throw new Error(
    `Queue not found: ${queueFile}`
  );
}

const queue = JSON.parse(
  fs.readFileSync(queueFile, "utf8")
);

if (!Array.isArray(queue.batches)) {
  throw new Error("Invalid MCQ queue");
}

const batchDirectory = path.join(
  ROOT,
  "data",
  "batches",
  `day-${String(DAY).padStart(3, "0")}`
);

fs.mkdirSync(batchDirectory, {
  recursive: true
});

function batchFile(batchNumber) {
  return path.join(
    batchDirectory,
    `DAY-${String(DAY).padStart(3, "0")}-BATCH-${String(
      batchNumber
    ).padStart(4, "0")}.json`
  );
}

function runBatch(batchNumber) {
  return new Promise((resolve, reject) => {
    console.log("");
    console.log("=".repeat(70));
    console.log(
      `QUEUE PROGRESS: BATCH ${batchNumber}/${queue.batches.length}`
    );
    console.log("=".repeat(70));

    const child = spawn(
      process.execPath,
      [
        path.join(
          ROOT,
          "generator",
          "generate-mcq-batch.js"
        ),
        String(DAY),
        String(batchNumber)
      ],
      {
        cwd: ROOT,
        stdio: "inherit"
      }
    );

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Batch process exited with code ${code}`
          )
        );
      }
    });
  });
}

console.log("");
console.log("VIDHWAAN CONTINUOUS MCQ DAY RUNNER");
console.log(`DAY: ${DAY}`);
console.log(`TOTAL QUEUE BATCHES: ${queue.batches.length}`);
console.log(`BATCH DIRECTORY: ${batchDirectory}`);
console.log("");

let completed = 0;
let skipped = 0;
let failed = 0;

for (const batch of queue.batches) {
  const number = batch.batch_number;
  const file = batchFile(number);

  if (fs.existsSync(file)) {
    console.log(
      `SKIP BATCH ${number}: already completed`
    );
    skipped++;
    completed++;
    continue;
  }

  try {
    await runBatch(number);

    if (!fs.existsSync(file)) {
      throw new Error(
        `Batch ${number} reported success but output file is missing`
      );
    }

    completed++;

    console.log(
      `BATCH ${number} CONFIRMED SAVED`
    );
  } catch (error) {
    failed++;

    console.error("");
    console.error(
      `BATCH ${number} FAILED: ${error.message}`
    );

    console.error(
      "STOPPING DAY RUNNER SAFELY."
    );

    console.error(
      "Completed batches remain saved and can be resumed."
    );

    process.exit(1);
  }
}

console.log("");
console.log("=".repeat(70));
console.log("DAY MCQ GENERATION FINISHED");
console.log("=".repeat(70));
console.log(`DAY: ${DAY}`);
console.log(`TOTAL BATCHES: ${queue.batches.length}`);
console.log(`COMPLETED: ${completed}`);
console.log(`SKIPPED EXISTING: ${skipped}`);
console.log(`FAILED: ${failed}`);
console.log("ALL QUEUE BATCHES PROCESSED");
console.log("STEP 94 COMPLETE");
