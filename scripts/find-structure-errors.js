import fs from "fs";
import path from "path";

const ROOT = path.join(process.cwd(), "syllabus");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      check(full);
    }
  }
}

function check(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));

  for (const chapter of data.chapters ?? []) {
    for (const topic of chapter.topics ?? []) {
      if (!Array.isArray(topic.subtopics)) {
        console.log(
          `MISSING SUBTOPICS | ${file} | ${chapter.title} | ${topic.title}`
        );
        continue;
      }

      for (const subtopic of topic.subtopics) {
        if (
          typeof subtopic.concept !== "string" ||
          !subtopic.concept.trim()
        ) {
          console.log(
            `MISSING CONCEPT | ${file} | ${chapter.title} | ${topic.title} | ${subtopic.title}`
          );
        }

        if (
          !Array.isArray(subtopic.learning_points) ||
          subtopic.learning_points.length === 0
        ) {
          console.log(
            `MISSING LEARNING_POINTS | ${file} | ${chapter.title} | ${topic.title} | ${subtopic.title}`
          );
        }
      }
    }
  }
}

walk(ROOT);
