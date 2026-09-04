import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const MANIFEST_RAW = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "data/daily-manifest.json"),
    "utf8"
  )
);

const MANIFEST = Array.isArray(MANIFEST_RAW)
  ? MANIFEST_RAW
  : MANIFEST_RAW.days;

const QUEUE_DIR = path.join(ROOT, "data", "mcq-queue");

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/validate-mcq-batch.js <batch-file>");
  process.exit(1);
}

const batchPath = path.resolve(file);

if (!fs.existsSync(batchPath)) {
  console.error(`FILE NOT FOUND: ${batchPath}`);
  process.exit(1);
}

const data = JSON.parse(
  fs.readFileSync(batchPath, "utf8")
);

const errors = [];

if (!Number.isInteger(data.day)) {
  errors.push("Invalid day");
}

const dayData = MANIFEST.find((d) => d.day === data.day);

if (!dayData) {
  errors.push(`Day ${data.day} not found in manifest`);
}

if (!data.batch_id) {
  errors.push("Missing batch_id");
}

if (!Array.isArray(data.mcqs)) {
  errors.push("mcqs must be an array");
}

/*
 * The filename, day, batch number, and queue batch must agree.
 * A generated batch is valid only when it is the exact batch
 * requested by the authoritative MCQ queue.
 */
const fileName = path.basename(batchPath);
const fileMatch = fileName.match(
  /^DAY-(\d{3})-BATCH-(\d{4})\.json$/
);

if (!fileMatch) {
  errors.push(
    `Invalid batch filename: ${fileName}. Expected DAY-NNN-BATCH-NNNN.json`
  );
}

const fileDay = fileMatch ? Number(fileMatch[1]) : null;
const fileBatch = fileMatch ? Number(fileMatch[2]) : null;

if (fileMatch && fileDay !== data.day) {
  errors.push(
    `Filename day ${fileDay} does not match data.day ${data.day}`
  );
}

const expectedBatchId =
  fileMatch
    ? `DAY-${String(fileDay).padStart(3, "0")}-BATCH-${String(fileBatch).padStart(4, "0")}`
    : null;

if (expectedBatchId && data.batch_id !== expectedBatchId) {
  errors.push(
    `batch_id mismatch: expected ${expectedBatchId}, got ${data.batch_id}`
  );
}

let queueBatch = null;

if (fileMatch) {
  const queuePath = path.join(
    QUEUE_DIR,
    `day-${String(fileDay).padStart(3, "0")}.json`
  );

  if (!fs.existsSync(queuePath)) {
    errors.push(`MCQ queue not found: ${queuePath}`);
  } else {
    try {
      const queue = JSON.parse(
        fs.readFileSync(queuePath, "utf8")
      );

      queueBatch = Array.isArray(queue.batches)
        ? queue.batches.find(
            (batch) => batch.batch_number === fileBatch
          )
        : null;

      if (!queueBatch) {
        errors.push(
          `Queue batch ${fileBatch} not found for Day ${fileDay}`
        );
      }
    } catch (error) {
      errors.push(
        `Unable to read queue: ${error.message}`
      );
    }
  }
}

if (queueBatch) {
  const expectedCount = Number(queueBatch.target_mcqs);

  if (
    !Number.isInteger(expectedCount) ||
    expectedCount < 1
  ) {
    errors.push(
      `Invalid queue target_mcqs for batch ${fileBatch}`
    );
  } else if (data.mcqs.length !== expectedCount) {
    errors.push(
      `MCQ count mismatch: expected ${expectedCount}, got ${data.mcqs.length}`
    );
  }

  /*
   * Every queue batch is deliberately constructed from one
   * learning unit. Therefore every generated MCQ must belong
   * to that exact learning unit.
   */
  const expectedUnitIds = new Set(
    queueBatch.jobs.map(
      (job) => job.learning_unit_id
    )
  );

  for (const [index, mcq] of data.mcqs.entries()) {
    if (
      mcq.learning_unit_id &&
      !expectedUnitIds.has(mcq.learning_unit_id)
    ) {
      errors.push(
        `MCQ ${index + 1}: learning_unit_id ${mcq.learning_unit_id} is not assigned to this queue batch`
      );
    }
  }
}

if (errors.length > 0) {
  console.error("VALIDATION FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

/*
 * JOB-LEVEL AUTHORITATIVE VALIDATION
 *
 * Every generated MCQ must correspond to exactly one queue job.
 * The following fields must match the queue job exactly:
 * job_number
 * learning_unit_id
 * learning_point
 * question_type
 * difficulty
 */
if (queueBatch) {
  const expectedJobs = new Map();

  for (const job of queueBatch.jobs) {
    expectedJobs.set(job.job_number, job);
  }

  const seenJobNumbers = new Set();

  for (const [index, mcq] of data.mcqs.entries()) {
    const label = `MCQ ${index + 1}`;
    const job = expectedJobs.get(mcq.job_number);

    if (!job) {
      errors.push(
        `${label}: job_number ${mcq.job_number} does not belong to this batch`
      );
      continue;
    }

    if (seenJobNumbers.has(mcq.job_number)) {
      errors.push(
        `${label}: duplicate job_number ${mcq.job_number}`
      );
    } else {
      seenJobNumbers.add(mcq.job_number);
    }

    if (mcq.learning_unit_id !== job.learning_unit_id) {
      errors.push(
        `${label}: learning_unit_id mismatch for job ${job.job_number}`
      );
    }

    if (mcq.learning_point !== job.learning_point) {
      errors.push(
        `${label}: learning_point mismatch for job ${job.job_number}`
      );
    }

    if (mcq.question_type !== job.question_type) {
      errors.push(
        `${label}: question_type mismatch for job ${job.job_number}`
      );
    }

    if (mcq.difficulty !== job.difficulty) {
      errors.push(
        `${label}: difficulty mismatch for job ${job.job_number}`
      );
    }
  }

  for (const job of queueBatch.jobs) {
    if (!seenJobNumbers.has(job.job_number)) {
      errors.push(
        `Missing generated MCQ for job ${job.job_number}`
      );
    }
  }
}

const units = new Map();
const learningPoints = new Map();

for (const unit of dayData.curriculum) {
  units.set(unit.learning_unit_id, unit);

  for (const point of unit.learning_points) {
    learningPoints.set(
      `${unit.learning_unit_id}|||${point}`,
      true
    );
  }
}

const mcqIds = new Set();
const questionKeys = new Set();
const coveredPoints = new Map();

for (const [index, mcq] of data.mcqs.entries()) {
  const label = `MCQ ${index + 1}`;

  if (!mcq.mcq_id) {
    errors.push(`${label}: missing mcq_id`);
  } else if (mcqIds.has(mcq.mcq_id)) {
    errors.push(`${label}: duplicate mcq_id ${mcq.mcq_id}`);
  } else {
    mcqIds.add(mcq.mcq_id);
  }

  if (!units.has(mcq.learning_unit_id)) {
    errors.push(
      `${label}: invalid learning_unit_id ${mcq.learning_unit_id}`
    );
    continue;
  }

  const coverageKey =
    `${mcq.learning_unit_id}|||${mcq.learning_point}`;

  if (!learningPoints.has(coverageKey)) {
    errors.push(
      `${label}: learning_point does not exactly match manifest`
    );
  } else {
    coveredPoints.set(
      coverageKey,
      (coveredPoints.get(coverageKey) || 0) + 1
    );
  }

  if (
    typeof mcq.question !== "string" ||
    !mcq.question.trim()
  ) {
    errors.push(`${label}: missing question`);
  }

  if (
    !mcq.options ||
    typeof mcq.options !== "object" ||
    Array.isArray(mcq.options)
  ) {
    errors.push(`${label}: invalid options`);
  } else {
    const optionKeys = Object.keys(mcq.options).sort();

    if (
      optionKeys.length !== 4 ||
      optionKeys.join(",") !== "A,B,C,D"
    ) {
      errors.push(
        `${label}: options must contain exactly A,B,C,D`
      );
    }

    for (const option of ["A", "B", "C", "D"]) {
      if (
        typeof mcq.options[option] !== "string" ||
        !mcq.options[option].trim()
      ) {
        errors.push(
          `${label}: option ${option} is empty`
        );
      }
    }
  }

  if (!["A", "B", "C", "D"].includes(mcq.correct_option)) {
    errors.push(
      `${label}: invalid correct_option`
    );
  } else if (
    mcq.answer !== mcq.options[mcq.correct_option]
  ) {
    errors.push(
      `${label}: answer does not match correct option`
    );
  }

  if (
    typeof mcq.explanation !== "string" ||
    !mcq.explanation.trim()
  ) {
    errors.push(`${label}: missing explanation`);
  }

  if (
    !["easy", "medium", "hard"].includes(mcq.difficulty)
  ) {
    errors.push(
      `${label}: invalid difficulty`
    );
  }

  const normalizedQuestion = mcq.question
    ?.toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (normalizedQuestion) {
    if (questionKeys.has(normalizedQuestion)) {
      errors.push(
        `${label}: duplicate question`
      );
    } else {
      questionKeys.add(normalizedQuestion);
    }
  }
}

const batchLearningPoints = new Set();

for (const mcq of data.mcqs) {
  const key =
    `${mcq.learning_unit_id}|||${mcq.learning_point}`;

  if (learningPoints.has(key)) {
    batchLearningPoints.add(key);
  }
}

console.log("MCQ BATCH VALIDATION");
console.log(`Day: ${data.day}`);
console.log(`Batch: ${data.batch_id}`);
console.log(`MCQs: ${data.mcqs.length}`);
console.log(`Day learning points: ${learningPoints.size}`);
console.log(`Batch learning points: ${batchLearningPoints.size}`);
console.log(`Covered learning points: ${coveredPoints.size}`);
console.log(`Unique MCQ IDs: ${mcqIds.size}`);
console.log(`Unique questions: ${questionKeys.size}`);

if (errors.length > 0) {
  console.error("");
  console.error("VALIDATION FAILED");
  console.error(`Errors: ${errors.length}`);

  for (const error of errors.slice(0, 50)) {
    console.error(`- ${error}`);
  }

  if (errors.length > 50) {
    console.error(
      `... ${errors.length - 50} additional errors`
    );
  }

  process.exit(1);
}

console.log("");
console.log("ALL MCQs MATCH THE MANIFEST");
console.log("ALL BATCH LEARNING POINTS VALID");
console.log("ALL MCQs HAVE EXACTLY FOUR OPTIONS");
console.log("ALL ANSWERS AND EXPLANATIONS VALID");
console.log("NO DUPLICATE MCQ IDs");
console.log("NO DUPLICATE QUESTIONS");
console.log("MCQ BATCH VALID");
console.log("STEP 79 COMPLETE");
