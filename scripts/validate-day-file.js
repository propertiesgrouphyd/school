import fs from "fs";
import path from "path";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node scripts/validate-day-file.js <json-file>");
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const manifest = JSON.parse(
  fs.readFileSync("data/daily-manifest.json", "utf8")
);

const content = JSON.parse(
  fs.readFileSync(filePath, "utf8")
);

const dayNumber = Number(content.day);

if (!Number.isInteger(dayNumber) || dayNumber < 1) {
  console.error("Invalid day number.");
  process.exit(1);
}

const manifestDay = manifest.days?.find(
  day => Number(day.day) === dayNumber
);

if (!manifestDay) {
  console.error(`Day ${dayNumber} not found in manifest.`);
  process.exit(1);
}

const errors = [];

const expectedLearningPoints = new Map();

for (const unit of expectedUnits) {
  for (const learningPoint of unit.learning_points) {
    const key = `${unit.learning_unit_id}|||${learningPoint}`;
    expectedLearningPoints.set(key, {
      learning_unit_id: unit.learning_unit_id,
      learning_point: learningPoint
    });
  }
}

const coveredLearningPoints = new Map();
const mcqIds = new Set();

for (const [index, mcq] of mcqs.entries()) {
  const label = `MCQ ${index + 1}`;

  if (!mcq.mcq_id) {
    errors.push(`${label}: missing mcq_id`);
  } else if (mcqIds.has(mcq.mcq_id)) {
    errors.push(`${label}: duplicate mcq_id: ${mcq.mcq_id}`);
  } else {
    mcqIds.add(mcq.mcq_id);
  }

  if (!mcq.learning_point) {
    errors.push(`${label}: missing learning_point`);
    continue;
  }

  if (!mcq.learning_unit_id) {
    errors.push(`${label}: missing learning_unit_id`);
    continue;
  }

  const coverageKey = `${mcq.learning_unit_id}|||${mcq.learning_point}`;

  if (!expectedLearningPoints.has(coverageKey)) {
    errors.push(
      `${label}: learning_point does not exactly match the manifest: ${mcq.learning_point}`
    );
    continue;
  }

  coveredLearningPoints.set(
    coverageKey,
    (coveredLearningPoints.get(coverageKey) || 0) + 1
  );
}

for (const [key, expected] of expectedLearningPoints.entries()) {
  const count = coveredLearningPoints.get(key) || 0;

  if (count === 0) {
    errors.push(
      `No MCQ coverage for learning point: ${expected.learning_unit_id} -> ${expected.learning_point}`
    );
  }
}

console.log("MCQ LEARNING POINT COVERAGE:");
console.log(`Expected learning points: ${expectedLearningPoints.size}`);
console.log(`Covered learning points: ${coveredLearningPoints.size}`);
console.log(`Unique MCQ IDs: ${mcqIds.size}`);


if (!Array.isArray(content.curriculum)) {
  errors.push("curriculum must be an array");
}

if (!Array.isArray(content.lessons)) {
  errors.push("lessons must be an array");
}

if (!Array.isArray(content.mcqs)) {
  errors.push("mcqs must be an array");
}

if (errors.length) {
  throw new Error(errors.join("\n"));
}

const expectedUnits = new Map(
  manifestDay.curriculum.map(unit => [
    unit.learning_unit_id,
    unit
  ])
);

const curriculumMap = new Map();
const lessonMap = new Map();

for (const unit of content.curriculum) {
  if (!unit.learning_unit_id) {
    errors.push("Curriculum item missing learning_unit_id");
    continue;
  }

  if (curriculumMap.has(unit.learning_unit_id)) {
    errors.push(`Duplicate curriculum unit: ${unit.learning_unit_id}`);
  }

  curriculumMap.set(unit.learning_unit_id, unit);
}

for (const lesson of content.lessons) {
  if (!lesson.learning_unit_id) {
    errors.push("Lesson missing learning_unit_id");
    continue;
  }

  if (lessonMap.has(lesson.learning_unit_id)) {
    errors.push(`Duplicate lesson: ${lesson.learning_unit_id}`);
  }

  lessonMap.set(lesson.learning_unit_id, lesson);
}

for (const [id, expected] of expectedUnits) {
  const actual = curriculumMap.get(id);

  if (!actual) {
    errors.push(`Missing curriculum unit: ${id}`);
    continue;
  }

  for (const field of [
    "class",
    "subject",
    "book",
    "chapter_number",
    "chapter",
    "topic",
    "subtopic",
    "concept"
  ]) {
    if (actual[field] !== expected[field]) {
      errors.push(`${id}: ${field} does not match manifest`);
    }
  }

  const expectedPoints = expected.learning_points || [];
  const actualPoints = actual.learning_points || [];

  if (!Array.isArray(actualPoints)) {
    errors.push(`${id}: learning_points must be an array`);
  } else {
    for (const point of expectedPoints) {
      if (!actualPoints.includes(point)) {
        errors.push(`${id}: missing learning point: ${point}`);
      }
    }
  }

  if (!lessonMap.has(id)) {
    errors.push(`Missing lesson: ${id}`);
  }
}

for (const id of curriculumMap.keys()) {
  if (!expectedUnits.has(id)) {
    errors.push(`Invalid curriculum unit: ${id}`);
  }
}

for (const [id, lesson] of lessonMap) {
  if (!expectedUnits.has(id)) {
    errors.push(`Invalid lesson learning_unit_id: ${id}`);
    continue;
  }

  for (const field of [
    "concept",
    "explanation",
    "key_points",
    "examples",
    "common_mistakes",
    "competitive_connections"
  ]) {
    const value = lesson[field];

    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && value.length === 0)
    ) {
      errors.push(`Lesson ${id}: missing ${field}`);
    }
  }
}

for (let i = 0; i < content.mcqs.length; i++) {
  const mcq = content.mcqs[i];
  const label = `MCQ ${i + 1}`;

  if (!expectedUnits.has(mcq.learning_unit_id)) {
    errors.push(`${label}: invalid learning_unit_id`);
  }

  if (
    typeof mcq.question !== "string" ||
    !mcq.question.trim()
  ) {
    errors.push(`${label}: missing question`);
  }

  const options = mcq.options;

  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    errors.push(`${label}: options must be an object`);
  } else {
    const keys = Object.keys(options).sort();

    if (keys.join(",") !== "A,B,C,D") {
      errors.push(`${label}: must have exactly A,B,C,D options`);
    }

    for (const key of ["A", "B", "C", "D"]) {
      if (
        typeof options[key] !== "string" ||
        !options[key].trim()
      ) {
        errors.push(`${label}: option ${key} is empty`);
      }
    }
  }

  if (!["A", "B", "C", "D"].includes(mcq.correct_option)) {
    errors.push(`${label}: invalid correct_option`);
  }

  if (
    ["A", "B", "C", "D"].includes(mcq.correct_option) &&
    mcq.answer !== mcq.options?.[mcq.correct_option]
  ) {
    errors.push(`${label}: answer does not match correct option`);
  }

  if (
    typeof mcq.explanation !== "string" ||
    !mcq.explanation.trim()
  ) {
    errors.push(`${label}: missing explanation`);
  }

  if (!["easy", "medium", "hard"].includes(mcq.difficulty)) {
    errors.push(`${label}: invalid difficulty`);
  }
}

if (content.curriculum.length !== expectedUnits.size) {
  errors.push(
    `Curriculum count mismatch: expected ${expectedUnits.size}, got ${content.curriculum.length}`
  );
}

if (content.lessons.length !== expectedUnits.size) {
  errors.push(
    `Lesson count mismatch: expected ${expectedUnits.size}, got ${content.lessons.length}`
  );
}

if (content.mcqs.length === 0) {
  errors.push("No MCQs generated");
}

if (errors.length) {
  console.error("VALIDATION FAILED");
  console.error(`Day: ${dayNumber}`);
  console.error(`Errors: ${errors.length}`);

  for (const error of errors.slice(0, 100)) {
    console.error(`- ${error}`);
  }

  process.exit(1);
}

console.log("DAY CONTENT VALID");
console.log(`Day: ${dayNumber}`);
console.log(`Learning units: ${expectedUnits.size}`);
console.log(`Lessons: ${content.lessons.length}`);
console.log(`MCQs: ${content.mcqs.length}`);
console.log("All syllabus units covered");
console.log("All learning points preserved");
console.log("All MCQs have exactly 4 options");
console.log("All answers and explanations validated");
