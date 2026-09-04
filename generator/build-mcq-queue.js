import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const manifestRaw = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "data/daily-manifest.json"),
    "utf8"
  )
);

const manifest = Array.isArray(manifestRaw)
  ? manifestRaw
  : manifestRaw.days;

if (!Array.isArray(manifest)) {
  throw new Error("Invalid daily manifest");
}

const config = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "config/generation-plan.json"),
    "utf8"
  )
);

const outputDirectory = path.join(
  ROOT,
  "data",
  "mcq-queue"
);

fs.mkdirSync(outputDirectory, { recursive: true });

const MCQS_PER_LEARNING_UNIT =
  config.generation.target_mcqs_per_learning_unit;

const MCQS_PER_BATCH = 8;

if (
  !Number.isInteger(MCQS_PER_LEARNING_UNIT) ||
  MCQS_PER_LEARNING_UNIT < 1
) {
  throw new Error("Invalid target MCQs per learning unit");
}

let totalDays = 0;
let totalUnits = 0;
let totalPoints = 0;
let totalTargetMcqs = 0;
let totalBatches = 0;

const ARCHETYPES = [
  "direct_concept",
  "conceptual_understanding",
  "definition_and_distinction",
  "application",
  "example_based",
  "scenario_based",
  "misconception_check",
  "reasoning",
  "comparison",
  "competitive_exam"
];

for (const day of manifest) {
  const queue = [];
  let batchNumber = 1;

  for (const unit of day.curriculum) {
    totalUnits++;

    const points = unit.learning_points;

    if (!Array.isArray(points) || points.length === 0) {
      throw new Error(
        `Learning unit ${unit.learning_unit_id} has no learning points`
      );
    }

    totalPoints += points.length;
    totalTargetMcqs += MCQS_PER_LEARNING_UNIT;

    const jobs = [];

    for (let i = 0; i < MCQS_PER_LEARNING_UNIT; i++) {
      const learningPoint =
        points[i % points.length];

      jobs.push({
        job_number: i + 1,
        learning_unit_id: unit.learning_unit_id,
        class: unit.class,
        subject: unit.subject,
        book: unit.book,
        chapter_number: unit.chapter_number,
        chapter: unit.chapter,
        topic: unit.topic,
        subtopic: unit.subtopic,
        concept: unit.concept,
        learning_point: learningPoint,
        question_type:
          ARCHETYPES[i % ARCHETYPES.length],
        difficulty:
          i % 10 < 4
            ? "easy"
            : i % 10 < 8
              ? "medium"
              : "hard"
      });
    }

    for (let i = 0; i < jobs.length; i += MCQS_PER_BATCH) {
      queue.push({
        batch_number: batchNumber++,
        target_mcqs: Math.min(
          MCQS_PER_BATCH,
          jobs.length - i
        ),
        jobs: jobs.slice(
          i,
          i + MCQS_PER_BATCH
        )
      });
    }
  }

  const file = path.join(
    outputDirectory,
    `day-${String(day.day).padStart(3, "0")}.json`
  );

  const output = {
    version: "2.0",
    day: day.day,
    strategy: {
      mcqs_per_learning_unit:
        MCQS_PER_LEARNING_UNIT,
      mcqs_per_batch: MCQS_PER_BATCH,
      repeated_learning_point_coverage: true,
      question_archetypes: ARCHETYPES,
      difficulty_distribution:
        "40% easy, 40% medium, 20% hard"
    },
    total_learning_units:
      day.curriculum.length,
    total_learning_points:
      day.curriculum.reduce(
        (sum, unit) =>
          sum + unit.learning_points.length,
        0
      ),
    target_mcqs: day.curriculum.length *
      MCQS_PER_LEARNING_UNIT,
    total_batches: queue.length,
    batches: queue
  };

  fs.writeFileSync(
    file,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  totalDays++;
  totalBatches += queue.length;
}

console.log("MCQ QUEUE CREATED");
console.log("DAYS:", totalDays);
console.log("LEARNING UNITS:", totalUnits);
console.log("LEARNING POINTS:", totalPoints);
console.log("TARGET MCQs:", totalTargetMcqs);
console.log("TOTAL MCQ BATCHES:", totalBatches);
console.log(
  "MCQs / LEARNING UNIT:",
  MCQS_PER_LEARNING_UNIT
);
console.log(
  "MCQs / BATCH:",
  MCQS_PER_BATCH
);
console.log("QUEUE DIRECTORY:", outputDirectory);
console.log("STEP 102 COMPLETE");
