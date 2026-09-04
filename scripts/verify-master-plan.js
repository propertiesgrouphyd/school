import fs from "fs";
import path from "path";

const ROOT = path.join(process.cwd(), "syllabus");
const MASTER = path.join(process.cwd(), "data", "master-plan.json");

const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(full);
    }
  }
}

walk(ROOT);
files.sort();

const master = JSON.parse(fs.readFileSync(MASTER, "utf8"));

const actual = {
  syllabus_files: files.length,
  chapters: 0,
  topics: 0,
  subtopics: 0,
  concepts: 0,
  learning_points: 0
};

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));

  actual.chapters += data.chapters.length;

  for (const chapter of data.chapters) {
    actual.topics += chapter.topics.length;

    for (const topic of chapter.topics) {
      actual.subtopics += topic.subtopics.length;

      for (const subtopic of topic.subtopics) {
        actual.concepts += subtopic.concepts.length;

        for (const concept of subtopic.concepts) {
          actual.learning_points += concept.learning_points.length;
        }
      }
    }
  }
}

const expected = master.totals;

for (const key of Object.keys(actual)) {
  if (actual[key] !== expected[key]) {
    throw new Error(
      `MASTER PLAN MISMATCH: ${key} | source=${actual[key]} | master=${expected[key]}`
    );
  }
}

if (!Array.isArray(master.classes)) {
  throw new Error("Master plan classes array is missing");
}

if (master.classes.length !== files.length) {
  throw new Error(
    `Master plan subject count mismatch: ${master.classes.length} vs ${files.length}`
  );
}

console.log("");
console.log("========================================");
console.log("VIDHWAAN SCHOOL — MASTER PLAN VERIFY");
console.log("========================================");
console.log("");
console.log(`Syllabus files:   ${actual.syllabus_files}`);
console.log(`Chapters:         ${actual.chapters}`);
console.log(`Topics:           ${actual.topics}`);
console.log(`Subtopics:        ${actual.subtopics}`);
console.log(`Concepts:         ${actual.concepts}`);
console.log(`Learning points:  ${actual.learning_points}`);
console.log("");
console.log("SOURCE AND MASTER PLAN MATCH");
console.log("MASTER PLAN VERIFIED");
console.log("========================================");
