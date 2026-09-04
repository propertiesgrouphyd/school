import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const ROOT = process.cwd();

const manifestPath = path.join(
  ROOT,
  "data",
  "daily-manifest.json"
);

const manifest = JSON.parse(
  fs.readFileSync(manifestPath, "utf8")
);

const days = Array.isArray(manifest)
  ? manifest
  : manifest.days;

if (!Array.isArray(days) || days.length === 0) {
  throw new Error("Invalid daily manifest");
}

function queueFile(dayNumber) {
  return path.join(
    ROOT,
    "data",
    "mcq-queue",
    `day-${String(dayNumber).padStart(3, "0")}.json`
  );
}

function batchFile(dayNumber, batchNumber) {
  return path.join(
    ROOT,
    "data",
    "batches",
    `day-${String(dayNumber).padStart(3, "0")}`,
    `DAY-${String(dayNumber).padStart(3, "0")}-BATCH-${String(
      batchNumber
    ).padStart(4, "0")}.json`
  );
}

function validateBatch(dayNumber, batchNumber) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        path.join(
          ROOT,
          "scripts",
          "validate-mcq-batch.js"
        ),
        batchFile(dayNumber, batchNumber)
      ],
      {
        cwd: ROOT,
        stdio: "ignore"
      }
    );

    child.on("error", () => resolve(false));

    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

async function findFirstIncompleteDay() {
  for (const day of days) {
    const dayNumber = Number(day.day);
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

    let validBatches = 0;

    for (const batch of queue.batches) {
      const number = Number(batch.batch_number);
      const output = batchFile(dayNumber, number);

      if (!fs.existsSync(output)) {
        continue;
      }

      if (await validateBatch(dayNumber, number)) {
        validBatches++;
      }
    }

    console.log(
      `DAY ${dayNumber}: ${validBatches}/${queue.batches.length} valid batches`
    );

    if (validBatches < queue.batches.length) {
      return dayNumber;
    }
  }

  return null;
}

async function runDay(dayNumber) {
  console.log("");
  console.log("=".repeat(70));
  console.log("VIDHWAAN SCHOOL — ONE DAY CI/CD GENERATION");
  console.log("=".repeat(70));
  console.log(`SELECTED DAY: ${dayNumber}`);
  console.log("ONLY THIS DAY WILL RUN");
  console.log("=".repeat(70));
  console.log("");

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
        ...process.env
      }
    }
  );

  return new Promise((resolve, reject) => {
    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Day ${dayNumber} runner exited with code ${code}`
        )
      );
    });
  });
}

const nextDay = await findFirstIncompleteDay();

if (nextDay === null) {
  console.log("");
  console.log("=".repeat(70));
  console.log("ALL 352 STUDY DAYS ARE COMPLETE");
  console.log("NO GENERATION REQUIRED");
  console.log("=".repeat(70));
  process.exit(0);
}

await runDay(nextDay);
