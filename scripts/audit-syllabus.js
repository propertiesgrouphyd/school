import fs from "fs";
import path from "path";

const ROOT = path.join(process.cwd(), "syllabus");

let files = [];

const totals = {
  classes: new Set(),
  subjects: new Set(),
  files: 0,
  chapters: 0,
  topics: 0,
  subtopics: 0,
  concepts: 0,
  learning_points: 0
};

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

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));

  if (!data.class) {
    throw new Error(`Missing class: ${file}`);
  }

  if (!data.subject) {
    throw new Error(`Missing subject: ${file}`);
  }

  if (!Array.isArray(data.chapters) || data.chapters.length === 0) {
    throw new Error(`Missing chapters: ${file}`);
  }

  totals.files++;
  totals.classes.add(String(data.class));
  totals.subjects.add(data.subject);
  totals.chapters += data.chapters.length;

  for (const chapter of data.chapters) {
    if (
      typeof chapter.chapter_number !== "number" ||
      typeof chapter.title !== "string" ||
      !chapter.title.trim()
    ) {
      throw new Error(`Invalid chapter: ${file}`);
    }

    if (!Array.isArray(chapter.topics) || chapter.topics.length === 0) {
      throw new Error(
        `Missing topics: ${file} -> ${chapter.title}`
      );
    }

    totals.topics += chapter.topics.length;

    for (const topic of chapter.topics) {
      if (typeof topic.name !== "string" || !topic.name.trim()) {
        throw new Error(
          `Missing topic name: ${file} -> ${chapter.title}`
        );
      }

      if (!Array.isArray(topic.subtopics) || topic.subtopics.length === 0) {
        throw new Error(
          `Missing subtopics: ${file} -> ${chapter.title} -> ${topic.name}`
        );
      }

      totals.subtopics += topic.subtopics.length;

      for (const subtopic of topic.subtopics) {
        if (
          typeof subtopic.name !== "string" ||
          !subtopic.name.trim()
        ) {
          throw new Error(
            `Missing subtopic name: ${file} -> ${chapter.title} -> ${topic.name}`
          );
        }

        if (
          !Array.isArray(subtopic.concepts) ||
          subtopic.concepts.length === 0
        ) {
          throw new Error(
            `Missing concepts: ${file} -> ${chapter.title} -> ${topic.name} -> ${subtopic.name}`
          );
        }

        for (const concept of subtopic.concepts) {
          if (
            typeof concept.name !== "string" ||
            !concept.name.trim()
          ) {
            throw new Error(
              `Missing concept name: ${file} -> ${chapter.title} -> ${topic.name} -> ${subtopic.name}`
            );
          }

          if (
            !Array.isArray(concept.learning_points) ||
            concept.learning_points.length === 0
          ) {
            throw new Error(
              `Missing learning_points: ${file} -> ${chapter.title} -> ${topic.name} -> ${subtopic.name} -> ${concept.name}`
            );
          }

          totals.concepts++;
          totals.learning_points += concept.learning_points.length;
        }
      }
    }
  }
}

console.log("");
console.log("========================================");
console.log("VIDHWAAN SCHOOL — SYLLABUS AUDIT");
console.log("========================================");
console.log("");
console.log(
  `Classes:         ${[...totals.classes].sort((a, b) => Number(a) - Number(b)).join(", ")}`
);
console.log(`Subjects:        ${[...totals.subjects].sort().join(", ")}`);
console.log(`JSON files:      ${totals.files}`);
console.log(`Chapters:        ${totals.chapters}`);
console.log(`Topics:          ${totals.topics}`);
console.log(`Subtopics:       ${totals.subtopics}`);
console.log(`Concepts:        ${totals.concepts}`);
console.log(`Learning points: ${totals.learning_points}`);
console.log("");
console.log("AUDIT PASSED");
console.log("========================================");
