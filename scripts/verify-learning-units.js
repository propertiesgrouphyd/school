import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "learning-units.json");

const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
const units = data.units;

if (!Array.isArray(units) || units.length === 0) {
  throw new Error("Learning units array is missing or empty");
}

const ids = new Set();

for (let i = 0; i < units.length; i++) {
  const unit = units[i];

  if (!unit.id) {
    throw new Error(`Missing ID at unit ${i + 1}`);
  }

  if (ids.has(unit.id)) {
    throw new Error(`Duplicate learning unit ID: ${unit.id}`);
  }

  ids.add(unit.id);

  const required = [
    "class",
    "subject",
    "chapter_number",
    "chapter",
    "topic",
    "subtopic",
    "concept"
  ];

  for (const field of required) {
    if (
      unit[field] === undefined ||
      unit[field] === null ||
      unit[field] === ""
    ) {
      throw new Error(`Missing ${field}: ${unit.id}`);
    }
  }

  if (
    !Array.isArray(unit.learning_points) ||
    unit.learning_points.length === 0
  ) {
    throw new Error(`Missing learning points: ${unit.id}`);
  }

  if (unit.learning_point_count !== unit.learning_points.length) {
    throw new Error(
      `Learning point count mismatch: ${unit.id}`
    );
  }
}

if (data.totals.learning_units !== units.length) {
  throw new Error(
    `Total learning unit mismatch: ${data.totals.learning_units} vs ${units.length}`
  );
}

const actualLearningPoints = units.reduce(
  (sum, unit) => sum + unit.learning_points.length,
  0
);

if (data.totals.learning_points !== actualLearningPoints) {
  throw new Error(
    `Total learning point mismatch: ${data.totals.learning_points} vs ${actualLearningPoints}`
  );
}

console.log("");
console.log("========================================");
console.log("VIDHWAAN SCHOOL — LEARNING UNIT VERIFY");
console.log("========================================");
console.log("");
console.log(`Learning units:  ${units.length}`);
console.log(`Unique IDs:      ${ids.size}`);
console.log(`Learning points: ${actualLearningPoints}`);
console.log("");
console.log("ALL LEARNING UNITS ARE UNIQUE AND COMPLETE");
console.log("LEARNING UNIT INDEX VERIFIED");
console.log("========================================");
