import fs from "fs";
import path from "path";

const ROOT = path.join(process.cwd(), "syllabus");
const OUTPUT = path.join(process.cwd(), "data", "master-plan.json");

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

const subjects = [];

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));

  subjects.push({
    class: Number(data.class),
    subject: data.subject,
    book: data.book ?? null,
    source_file: path.relative(process.cwd(), file),
    chapters: data.chapters
  });
}

subjects.sort((a, b) => {
  if (a.class !== b.class) return a.class - b.class;
  return a.subject.localeCompare(b.subject);
});

let chapterCount = 0;
let topicCount = 0;
let subtopicCount = 0;
let conceptCount = 0;
let learningPointCount = 0;

for (const subject of subjects) {
  chapterCount += subject.chapters.length;

  for (const chapter of subject.chapters) {
    topicCount += chapter.topics.length;

    for (const topic of chapter.topics) {
      subtopicCount += topic.subtopics.length;

      for (const subtopic of topic.subtopics) {
        conceptCount += subtopic.concepts.length;

        for (const concept of subtopic.concepts) {
          learningPointCount += concept.learning_points.length;
        }
      }
    }
  }
}

const masterPlan = {
  project: "VIDHWAAN School",
  version: "1.0.0",
  generated_at: new Date().toISOString(),

  purpose: {
    description:
      "Master curriculum plan for Classes 6–12. This plan is derived directly from the syllabus hierarchy and is the source for future daily content generation.",
    generation_policy:
      "Daily content must be generated from this master plan. Groq must not invent or replace the master syllabus."
  },

  hierarchy: [
    "class",
    "subject",
    "chapter",
    "topic",
    "subtopic",
    "concept",
    "learning_points"
  ],

  totals: {
    syllabus_files: subjects.length,
    chapters: chapterCount,
    topics: topicCount,
    subtopics: subtopicCount,
    concepts: conceptCount,
    learning_points: learningPointCount
  },

  classes: subjects
};

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(masterPlan, null, 2) + "\n",
  "utf8"
);

console.log("");
console.log("========================================");
console.log("VIDHWAAN SCHOOL — MASTER PLAN");
console.log("========================================");
console.log("");
console.log(`Syllabus files:   ${subjects.length}`);
console.log(`Chapters:         ${chapterCount}`);
console.log(`Topics:           ${topicCount}`);
console.log(`Subtopics:        ${subtopicCount}`);
console.log(`Concepts:         ${conceptCount}`);
console.log(`Learning points:  ${learningPointCount}`);
console.log("");
console.log(`Created: ${path.relative(process.cwd(), OUTPUT)}`);
console.log("");
console.log("MASTER PLAN CREATED");
console.log("========================================");
