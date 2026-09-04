import fs from "fs";
import path from "path";

const INPUT = path.join(process.cwd(), "data", "learning-units.json");
const OUTPUT = path.join(process.cwd(), "data", "day-plan.json");

const data = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const units = data.units;

if (!Array.isArray(units) || units.length === 0) {
  throw new Error("No learning units found");
}

/*
  Planning model

  A learning unit contains one concept and all of its learning points.
  We use learning-point workload as the primary planning measure.

  Target:
    approximately 20 learning points per study day.

  A concept is never split between days.
  If adding the next concept would make a day substantially oversized,
  a new day begins before that concept.
*/

const TARGET_POINTS_PER_DAY = 20;
const MAX_POINTS_PER_DAY = 30;

const days = [];
let currentUnits = [];
let currentPoints = 0;

function createDay() {
  if (currentUnits.length === 0) return;

  days.push({
    day: days.length + 1,
    learning_units: currentUnits,
    learning_unit_ids: currentUnits.map((u) => u.id),
    learning_point_count: currentPoints
  });

  currentUnits = [];
  currentPoints = 0;
}

for (const unit of units) {
  const points = unit.learning_point_count;

  if (currentUnits.length === 0) {
    currentUnits.push(unit);
    currentPoints = points;
    continue;
  }

  const wouldExceedTarget =
    currentPoints >= TARGET_POINTS_PER_DAY;

  const wouldExceedMaximum =
    currentPoints + points > MAX_POINTS_PER_DAY;

  if (wouldExceedTarget || wouldExceedMaximum) {
    createDay();

    currentUnits.push(unit);
    currentPoints = points;
  } else {
    currentUnits.push(unit);
    currentPoints += points;
  }
}

createDay();

const assignedIds = days.flatMap((day) => day.learning_unit_ids);
const uniqueIds = new Set(assignedIds);

if (assignedIds.length !== units.length) {
  throw new Error(
    `Learning unit assignment mismatch: ${assignedIds.length} vs ${units.length}`
  );
}

if (uniqueIds.size !== units.length) {
  throw new Error("Duplicate learning unit detected in day plan");
}

for (let i = 0; i < days.length; i++) {
  if (days[i].day !== i + 1) {
    throw new Error(`Invalid day sequence at day ${i + 1}`);
  }
}

const totalPoints = days.reduce(
  (sum, day) => sum + day.learning_point_count,
  0
);

if (totalPoints !== data.totals.learning_points) {
  throw new Error(
    `Learning point mismatch: ${totalPoints} vs ${data.totals.learning_points}`
  );
}

const output = {
  project: "VIDHWAAN School",
  version: "1.0.0",
  source: "data/learning-units.json",

  planning_model: {
    target_learning_points_per_day: TARGET_POINTS_PER_DAY,
    maximum_learning_points_per_day: MAX_POINTS_PER_DAY,
    concept_split: false,
    order_preserved: true
  },

  totals: {
    learning_units: units.length,
    learning_points: totalPoints,
    study_days: days.length
  },

  days
};

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log("");
console.log("========================================");
console.log("VIDHWAAN SCHOOL — DAY PLAN");
console.log("========================================");
console.log("");
console.log(`Learning units:   ${units.length}`);
console.log(`Learning points:  ${totalPoints}`);
console.log(`Study days:       ${days.length}`);
console.log(`Target/day:       ${TARGET_POINTS_PER_DAY}`);
console.log(`Maximum/day:      ${MAX_POINTS_PER_DAY}`);
console.log("");
console.log(`Created: ${path.relative(process.cwd(), OUTPUT)}`);
console.log("");
console.log("DAY PLAN CREATED");
console.log("========================================");
