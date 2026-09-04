import fs from "fs";
import path from "path";

const root = "syllabus";
let files = [];
let errors = [];

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (item.name.endsWith(".json")) files.push(full);
  }
}

walk(root);

for (const file of files) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));

    if (!data.class) errors.push(`${file}: missing class`);
    if (!data.subject) errors.push(`${file}: missing subject`);
    if (!Array.isArray(data.chapters)) {
      errors.push(`${file}: chapters must be an array`);
      continue;
    }

    for (const chapter of data.chapters) {
      if (!chapter.chapter_number) {
        errors.push(`${file}: chapter missing chapter_number`);
      }
      if (!chapter.title) {
        errors.push(`${file}: chapter missing title`);
      }
      if (!Array.isArray(chapter.topics)) {
        errors.push(`${file}: ${chapter.title}: topics must be an array`);
      }
    }
  } catch (error) {
    errors.push(`${file}: invalid JSON — ${error.message}`);
  }
}

console.log(`JSON files checked: ${files.length}`);

if (errors.length) {
  console.error("\nVALIDATION FAILED\n");
  errors.forEach(error => console.error(" - " + error));
  process.exit(1);
}

console.log("VALIDATION PASSED");
