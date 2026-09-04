import fs from "fs";
import path from "path";

const ROOT = path.join(process.cwd(), "syllabus");

let files = [];

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

function normalizeTopic(topic, file, chapterTitle) {
  const topicName = topic.name ?? topic.title;

  if (!topicName) {
    throw new Error(
      `Missing topic title/name: ${file} -> ${chapterTitle}`
    );
  }

  if (!Array.isArray(topic.subtopics)) {
    throw new Error(
      `Missing subtopics: ${file} -> ${chapterTitle} -> ${topicName}`
    );
  }

  const subtopics = topic.subtopics.map((subtopic) => {
    const subtopicName = subtopic.name ?? subtopic.title;

    if (!subtopicName) {
      throw new Error(
        `Missing subtopic title/name: ${file} -> ${chapterTitle} -> ${topicName}`
      );
    }

    // Format:
    // subtopic.concepts = [{ name, learning_points }]
    if (Array.isArray(subtopic.concepts)) {
      return {
        name: subtopicName,
        concepts: subtopic.concepts.map((concept) => {
          const conceptName = concept.name ?? concept.title;

          if (!conceptName) {
            throw new Error(
              `Missing concept name: ${file} -> ${chapterTitle} -> ${topicName} -> ${subtopicName}`
            );
          }

          if (
            !Array.isArray(concept.learning_points) ||
            concept.learning_points.length === 0
          ) {
            throw new Error(
              `Missing learning_points: ${file} -> ${chapterTitle} -> ${topicName} -> ${subtopicName} -> ${conceptName}`
            );
          }

          return {
            name: conceptName,
            learning_points: concept.learning_points
          };
        })
      };
    }

    // Format:
    // subtopic.concept + subtopic.learning_points
    if (
      typeof subtopic.concept === "string" &&
      Array.isArray(subtopic.learning_points) &&
      subtopic.learning_points.length > 0
    ) {
      return {
        name: subtopicName,
        concepts: [
          {
            name: subtopic.concept,
            learning_points: subtopic.learning_points
          }
        ]
      };
    }

    throw new Error(
      `Invalid subtopic structure: ${file} -> ${chapterTitle} -> ${topicName} -> ${subtopicName}`
    );
  });

  return {
    name: topicName,
    subtopics
  };
}

function normalizeFile(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));

  if (!Array.isArray(data.chapters)) {
    throw new Error(`Missing chapters: ${file}`);
  }

  data.chapters = data.chapters.map((chapter) => {
    if (!Array.isArray(chapter.topics)) {
      throw new Error(
        `Missing topics: ${file} -> ${chapter.title}`
      );
    }

    return {
      ...chapter,
      topics: chapter.topics.map((topic) =>
        normalizeTopic(topic, file, chapter.title)
      )
    };
  });

  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );
}

walk(ROOT);
files.sort();

for (const file of files) {
  normalizeFile(file);
  console.log(`NORMALIZED: ${file}`);
}

console.log("");
console.log(`Files normalized: ${files.length}`);
console.log("NORMALIZATION PASSED");
