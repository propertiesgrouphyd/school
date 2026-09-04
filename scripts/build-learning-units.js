import fs from "fs";
import path from "path";

const MASTER = path.join(process.cwd(), "data", "master-plan.json");
const OUTPUT = path.join(process.cwd(), "data", "learning-units.json");

const master = JSON.parse(fs.readFileSync(MASTER, "utf8"));

const units = [];
let unitNumber = 1;

for (const subject of master.classes) {
  for (const chapter of subject.chapters) {
    for (const topic of chapter.topics) {
      for (const subtopic of topic.subtopics) {
        for (const concept of subtopic.concepts) {
          const id = `LU-${String(unitNumber).padStart(5, "0")}`;

          units.push({
            id,
            class: subject.class,
            subject: subject.subject,
            book: subject.book,
            chapter_number: chapter.chapter_number,
            chapter: chapter.title,
            topic: topic.name,
            subtopic: subtopic.name,
            concept: concept.name,
            learning_points: concept.learning_points,
            learning_point_count: concept.learning_points.length
          });

          unitNumber++;
        }
      }
    }
  }
}

const output = {
  project: "VIDHWAAN School",
  version: "1.0.0",
  source: "data/master-plan.json",

  definition:
    "One learning unit represents one syllabus concept together with all of its required learning points.",

  totals: {
    learning_units: units.length,
    learning_points: units.reduce(
      (sum, unit) => sum + unit.learning_point_count,
      0
    )
  },

  units
};

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log("");
console.log("========================================");
console.log("VIDHWAAN SCHOOL — LEARNING UNITS");
console.log("========================================");
console.log("");
console.log(`Learning units:  ${units.length}`);
console.log(`Learning points: ${output.totals.learning_points}`);
console.log(`Created: ${path.relative(process.cwd(), OUTPUT)}`);
console.log("");
console.log("LEARNING UNIT INDEX CREATED");
console.log("========================================");
