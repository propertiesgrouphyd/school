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

if (errors.length > 0) {
  console.error("VALIDATION FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
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
