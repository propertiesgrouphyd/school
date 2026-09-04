import fs from "fs";
import path from "path";

const PLAN = path.join(process.cwd(), "data", "day-plan.json");
const OUTPUT = path.join(process.cwd(), "data", "daily-manifest.json");

const plan = JSON.parse(fs.readFileSync(PLAN, "utf8"));

const days = plan.days.map((day) => ({
  day: day.day,
  learning_point_count: day.learning_point_count,

  curriculum: day.learning_units.map((unit) => ({
    learning_unit_id: unit.id,
    class: unit.class,
    subject: unit.subject,
    book: unit.book,
    chapter_number: unit.chapter_number,
    chapter: unit.chapter,
    topic: unit.topic,
    subtopic: unit.subtopic,
    concept: unit.concept,
    learning_points: unit.learning_points
  }))
}));

const manifest = {
  project: "VIDHWAAN School",
  version: "1.0.0",
  source: "data/day-plan.json",

  purpose:
    "Deterministic daily syllabus manifest. Each day contains the exact curriculum units that future content generation must teach.",

  generation_rules: [
    "Teach every listed learning point.",
    "Do not omit listed concepts or learning points.",
    "Do not invent replacement syllabus topics.",
    "Preserve class, subject, chapter, topic, subtopic and concept context.",
    "Use the listed curriculum as the authoritative scope for that day."
  ],

  totals: {
    study_days: days.length,
    learning_units: days.reduce(
      (sum, day) => sum + day.curriculum.length,
      0
    ),
    learning_points: days.reduce(
      (sum, day) => sum + day.learning_point_count,
      0
    )
  },

  days
};

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8"
);

console.log("");
console.log("========================================");
console.log("VIDHWAAN SCHOOL — DAILY MANIFEST");
console.log("========================================");
console.log("");
console.log(`Study days:       ${manifest.totals.study_days}`);
console.log(`Learning units:   ${manifest.totals.learning_units}`);
console.log(`Learning points:  ${manifest.totals.learning_points}`);
console.log(`Created: ${path.relative(process.cwd(), OUTPUT)}`);
console.log("");
console.log("DAILY MANIFEST CREATED");
console.log("========================================");
