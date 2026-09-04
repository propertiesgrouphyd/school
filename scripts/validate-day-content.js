import fs from "fs";
import path from "path";

const dayNumber = Number(process.argv[2]);

if (!Number.isInteger(dayNumber) || dayNumber < 1) {
  console.error("Usage: node scripts/validate-day-content.js <day-number>");
  process.exit(1);
}

const manifest = JSON.parse(
  fs.readFileSync("data/daily-manifest.json", "utf8")
);

const outputPath = path.join(
  "data",
  "days",
  `day-${String(dayNumber).padStart(3, "0")}.json`
);

if (!fs.existsSync(outputPath)) {
  console.error(`DAY CONTENT NOT FOUND: ${outputPath}`);
  process.exit(1);
}

let content;

try {
  content = JSON.parse(fs.readFileSync(outputPath, "utf8"));
} catch (error) {
  console.error("INVALID DAY JSON");
  console.error(error.message);
  process.exit(1);
}

const manifestDay = manifest.days?.find(
  day => Number(day.day) === dayNumber
);

if (!manifestDay) {
  console.error(`Day ${dayNumber} not found in daily manifest.`);
  process.exit(1);
}

const errors = [];

if (Number(content.day) !== dayNumber) {
  errors.push(`Wrong day number: expected ${dayNumber}`);
}

for (const field of ["curriculum", "lessons", "mcqs"]) {
  if (!Array.isArray(content[field])) {
    errors.push(`${field} must be an array`);
  }
}

if (errors.length) {
  console.error("VALIDATION FAILED");
  errors.forEach(e => console.error(`- ${e}`));
  process.exit(1);
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
    errors.push(
      `Duplicate curriculum unit: ${unit.learning_unit_id}`
    );
  }

  curriculumMap.set(unit.learning_unit_id, unit);
}

for (const lesson of content.lessons) {
  if (!lesson.learning_unit_id) {
    errors.push("Lesson missing learning_unit_id");
    continue;
  }

  if (lessonMap.has(lesson.learning_unit_id)) {
    errors.push(
      `Duplicate lesson: ${lesson.learning_unit_id}`
    );
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

  for (const point of expectedPoints) {
    if (!actualPoints.includes(point)) {
      errors.push(`${id}: missing learning point: ${point}`);
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
    errors.push(
      `${label}: invalid learning_unit_id`
    );
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
      errors.push(
        `${label}: must have exactly A,B,C,D options`
      );
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

if (errors.length > 0) {
  console.error("VALIDATION FAILED");
  console.error(`Day: ${dayNumber}`);
  console.error(`Errors: ${errors.length}`);

  for (const error of errors.slice(0, 100)) {
    console.error(`- ${error}`);
  }

  if (errors.length > 100) {
    console.error(`... and ${errors.length - 100} more errors`);
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
