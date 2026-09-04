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

async function configureGitIdentity() {
  if (process.env.GITHUB_ACTIONS !== "true") {
    return;
  }

  await runCommand("git", ["config", "user.name", "github-actions[bot]"]);
  await runCommand(
    "git",
    ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]
  );
}

async function checkpointBatches() {
  await configureGitIdentity();

  if (process.env.GITHUB_ACTIONS !== "true") {
    return;
  }

  const { spawn } = await import("child_process");

  await new Promise((resolve, reject) => {
    const add = spawn(
      "git",
      ["add", "data/batches"],
      {
        cwd: ROOT,
        stdio: "inherit"
      }
    );

    add.on("error", reject);

    add.on("close", (addCode) => {
      if (addCode !== 0) {
        reject(new Error("Git staging failed during batch checkpoint"));
        return;
      }

      const diff = spawn(
        "git",
        ["diff", "--cached", "--quiet"],
        {
          cwd: ROOT,
          stdio: "inherit"
        }
      );

      diff.on("error", reject);

      diff.on("close", (diffCode) => {
        if (diffCode === 0) {
          resolve();
          return;
        }

        const commit = spawn(
          "git",
          [
            "commit",
            "-m",
            `Checkpoint Vidhwaan School Day ${DAY} batches`
          ],
          {
            cwd: ROOT,
            stdio: "inherit"
          }
        );

        commit.on("error", reject);

        commit.on("close", (commitCode) => {
          if (commitCode !== 0) {
            reject(
              new Error("Git commit failed during batch checkpoint")
            );
            return;
          }

          const pushWithRetry = (attempt = 1) => {
            const push = spawn(
              "git",
              ["push", "origin", "main"],
              {
                cwd: ROOT,
                stdio: "inherit"
              }
            );

            push.on("error", (error) => {
              if (attempt >= 5) {
                reject(
                  new Error(
                    `Git push failed after ${attempt} attempts: ${error.message}`
                  )
                );
                return;
              }

              const waitMs = Math.min(60000, 5000 * attempt);

              console.log(
                `GIT PUSH RETRY ${attempt + 1}/5 — waiting ${Math.ceil(
                  waitMs / 1000
                )}s`
              );

              setTimeout(
                () => pushWithRetry(attempt + 1),
                waitMs
              );
            });

            push.on("close", (pushCode) => {
              if (pushCode === 0) {
                console.log(
                  `BATCH CHECKPOINT: Day ${DAY} pushed to GitHub`
                );
                resolve();
                return;
              }

              if (attempt >= 5) {
                reject(
                  new Error(
                    `Git push failed after ${attempt} attempts`
                  )
                );
                return;
              }

              const waitMs = Math.min(60000, 5000 * attempt);

              console.log(
                `GIT PUSH RETRY ${attempt + 1}/5 — waiting ${Math.ceil(
                  waitMs / 1000
                )}s`
              );

              setTimeout(
                () => pushWithRetry(attempt + 1),
                waitMs
              );
            });
          };

          pushWithRetry();
        });
      });
    });
  });
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
      `VERIFYING EXISTING BATCH ${number}...`
    );

    const validator = spawn(
      process.execPath,
      [
        path.join(
          ROOT,
          "scripts",
          "validate-mcq-batch.js"
        ),
        file
      ],
      {
        cwd: ROOT,
        stdio: "inherit"
      }
    );

    const validationCode = await new Promise((resolve, reject) => {
      validator.on("error", reject);
      validator.on("close", resolve);
    });

    if (validationCode === 0) {
      console.log(
        `SKIP BATCH ${number}: existing batch VALID`
      );
      skipped++;
      completed++;
      continue;
    }

    console.log(
      `EXISTING BATCH ${number} IS INVALID — REGENERATING`
    );

    fs.rmSync(file, { force: true });
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

    if (
      process.env.GITHUB_ACTIONS === "true" &&
      completed % 5 === 0
    ) {
      await checkpointBatches();
    }
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
