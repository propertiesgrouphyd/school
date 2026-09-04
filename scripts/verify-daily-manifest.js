import fs from "fs";
import path from "path";

const UNITS_FILE = path.join(process.cwd(), "data", "learning-units.json");
const MANIFEST_FILE = path.join(process.cwd(), "data", "daily-manifest.json");

const unitsData = JSON.parse(fs.readFileSync(UNITS_FILE, "utf8"));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));

const sourceUnits = unitsData.units;
const sourceIds = new Set(sourceUnits.map((unit) => unit.id));

if (!Array.isArray(manifest.days)) {
  throw new Error("Manifest days array is missing");
}

const manifestIds = [];
let manifestLearningPoints = 0;

for (let i = 0; i < manifest.days.length; i++) {
  const day = manifest.days[i];

  if (day.day !== i + 1) {
    throw new Error(`Invalid day number: ${day.day}`);
  }

  if (!Array.isArray(day.curriculum)) {
    throw new Error(`Missing curriculum on day ${day.day}`);
  }

  let dayPoints = 0;

  for (const unit of day.curriculum) {
    if (!unit.learning_unit_id) {
      throw new Error(`Missing learning_unit_id on day ${day.day}`);
    }

    if (!sourceIds.has(unit.learning_unit_id)) {
      throw new Error(
        `Unknown learning unit: ${unit.learning_unit_id}`
      );
    }

    if (
      !Array.isArray(unit.learning_points) ||
      unit.learning_points.length === 0
    ) {
      throw new Error(
        `Missing learning points: ${unit.learning_unit_id}`
      );
    }

    const source = sourceUnits.find(
      (item) => item.id === unit.learning_unit_id
    );

    if (unit.class !== source.class) {
      throw new Error(`Class mismatch: ${unit.learning_unit_id}`);
    }

    if (unit.subject !== source.subject) {
      throw new Error(`Subject mismatch: ${unit.learning_unit_id}`);
    }

    if (unit.chapter !== source.chapter) {
      throw new Error(`Chapter mismatch: ${unit.learning_unit_id}`);
    }

    if (unit.topic !== source.topic) {
      throw new Error(`Topic mismatch: ${unit.learning_unit_id}`);
    }

    if (unit.subtopic !== source.subtopic) {
      throw new Error(`Subtopic mismatch: ${unit.learning_unit_id}`);
    }

    if (unit.concept !== source.concept) {
      throw new Error(`Concept mismatch: ${unit.learning_unit_id}`);
    }

    if (
      JSON.stringify(unit.learning_points) !==
      JSON.stringify(source.learning_points)
    ) {
      throw new Error(
        `Learning points changed: ${unit.learning_unit_id}`
      );
    }

    manifestIds.push(unit.learning_unit_id);
    dayPoints += unit.learning_points.length;
  }

  if (dayPoints !== day.learning_point_count) {
    throw new Error(
      `Day ${day.day} point count mismatch: ${dayPoints} vs ${day.learning_point_count}`
    );
  }

  manifestLearningPoints += dayPoints;
}

const uniqueIds = new Set(manifestIds);

if (manifestIds.length !== sourceUnits.length) {
  throw new Error(
    `Manifest unit count mismatch: ${manifestIds.length} vs ${sourceUnits.length}`
  );
}

if (uniqueIds.size !== sourceUnits.length) {
  throw new Error("Duplicate learning unit in manifest");
}

if (manifestLearningPoints !== unitsData.totals.learning_points) {
  throw new Error(
    `Manifest learning point mismatch: ${manifestLearningPoints} vs ${unitsData.totals.learning_points}`
  );
}

if (manifest.totals.study_days !== manifest.days.length) {
  throw new Error("Manifest study day total mismatch");
}

if (manifest.totals.learning_units !== uniqueIds.size) {
  throw new Error("Manifest learning unit total mismatch");
}

if (manifest.totals.learning_points !== manifestLearningPoints) {
  throw new Error("Manifest learning point total mismatch");
}

console.log("");
console.log("========================================");
console.log("VIDHWAAN SCHOOL — DAILY MANIFEST VERIFY");
console.log("========================================");
console.log("");
console.log(`Study days:       ${manifest.days.length}`);
console.log(`Learning units:   ${uniqueIds.size}`);
console.log(`Learning points:  ${manifestLearningPoints}`);
console.log("");
console.log("ALL CURRICULUM DATA PRESERVED");
console.log("ALL LEARNING UNITS ASSIGNED EXACTLY ONCE");
console.log("DAILY MANIFEST VERIFIED");
console.log("========================================");
