import fs from "fs";
import path from "path";

const UNITS_FILE = path.join(process.cwd(), "data", "learning-units.json");
const PLAN_FILE = path.join(process.cwd(), "data", "day-plan.json");

const unitsData = JSON.parse(fs.readFileSync(UNITS_FILE, "utf8"));
const plan = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));

const units = unitsData.units;
const days = plan.days;

if (!Array.isArray(days) || days.length === 0) {
  throw new Error("Day plan is empty");
}

const sourceIds = new Set(units.map((unit) => unit.id));
const assignedIds = [];

for (let i = 0; i < days.length; i++) {
  const day = days[i];

  if (day.day !== i + 1) {
    throw new Error(`Invalid day sequence at day ${i + 1}`);
  }

  if (!Array.isArray(day.learning_units)) {
    throw new Error(`Missing learning_units on day ${day.day}`);
  }

  if (!Array.isArray(day.learning_unit_ids)) {
    throw new Error(`Missing learning_unit_ids on day ${day.day}`);
  }

  if (day.learning_units.length !== day.learning_unit_ids.length) {
    throw new Error(`Unit list mismatch on day ${day.day}`);
  }

  const calculatedPoints = day.learning_units.reduce(
    (sum, unit) => sum + unit.learning_point_count,
    0
  );

  if (calculatedPoints !== day.learning_point_count) {
    throw new Error(`Learning point mismatch on day ${day.day}`);
  }

  for (let j = 0; j < day.learning_units.length; j++) {
    const unit = day.learning_units[j];

    if (unit.id !== day.learning_unit_ids[j]) {
      throw new Error(
        `ID mismatch on day ${day.day}: ${unit.id} vs ${day.learning_unit_ids[j]}`
      );
    }

    if (!sourceIds.has(unit.id)) {
      throw new Error(
        `Unknown learning unit ${unit.id} on day ${day.day}`
      );
    }

    assignedIds.push(unit.id);
  }
}

if (assignedIds.length !== units.length) {
  throw new Error(
    `Assigned unit count mismatch: ${assignedIds.length} vs ${units.length}`
  );
}

const uniqueIds = new Set(assignedIds);

if (uniqueIds.size !== units.length) {
  throw new Error("Duplicate learning unit found in day plan");
}

for (const id of sourceIds) {
  if (!uniqueIds.has(id)) {
    throw new Error(`Unassigned learning unit: ${id}`);
  }
}

const totalPoints = days.reduce(
  (sum, day) => sum + day.learning_point_count,
  0
);

if (totalPoints !== unitsData.totals.learning_points) {
  throw new Error(
    `Total learning points mismatch: ${totalPoints} vs ${unitsData.totals.learning_points}`
  );
}

if (plan.totals.study_days !== days.length) {
  throw new Error("Study day total mismatch");
}

console.log("");
console.log("========================================");
console.log("VIDHWAAN SCHOOL — DAY PLAN VERIFY");
console.log("========================================");
console.log("");
console.log(`Study days:       ${days.length}`);
console.log(`Learning units:   ${uniqueIds.size}`);
console.log(`Learning points:  ${totalPoints}`);
console.log("");
console.log("ALL UNITS ASSIGNED EXACTLY ONCE");
console.log("DAY SEQUENCE VERIFIED");
console.log("DAY PLAN VERIFIED");
console.log("========================================");
