import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const PROGRESS_FILE = path.join(
  ROOT,
  "data/generation-progress.json"
);

function emptyProgress() {
  return {
    version: "1.0",
    started_at: null,
    updated_at: null,
    status: "not_started",
    days: {},
    totals: {
      completed_batches: 0,
      completed_days: 0,
      mcqs_generated: 0,
      failed_batches: 0,
      retries: 0
    }
  };
}

export function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) {
    return emptyProgress();
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(PROGRESS_FILE, "utf8")
    );

    if (!data.days || typeof data.days !== "object") {
      return emptyProgress();
    }

    if (!data.totals || typeof data.totals !== "object") {
      data.totals = emptyProgress().totals;
    }

    return data;
  } catch {
    throw new Error(
      "generation-progress.json exists but is invalid"
    );
  }
}

export function saveProgress(progress) {
  progress.updated_at = new Date().toISOString();

  const temp = `${PROGRESS_FILE}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(progress, null, 2),
    "utf8"
  );

  fs.renameSync(temp, PROGRESS_FILE);
}

export function markStarted(progress) {
  if (!progress.started_at) {
    progress.started_at = new Date().toISOString();
  }

  progress.status = "running";

  saveProgress(progress);
}

export function markBatchCompleted(
  progress,
  day,
  batchId,
  mcqCount
) {
  const key = String(day);

  if (!progress.days[key]) {
    progress.days[key] = {
      completed_batches: [],
      mcqs_generated: 0,
      status: "in_progress"
    };
  }

  const dayProgress = progress.days[key];

  if (!dayProgress.completed_batches.includes(batchId)) {
    dayProgress.completed_batches.push(batchId);
    dayProgress.mcqs_generated += mcqCount;
    progress.totals.completed_batches += 1;
    progress.totals.mcqs_generated += mcqCount;
  }

  saveProgress(progress);
}

export function markDayCompleted(
  progress,
  day
) {
  const key = String(day);

  if (!progress.days[key]) {
    progress.days[key] = {
      completed_batches: [],
      mcqs_generated: 0,
      status: "completed"
    };
  }

  if (progress.days[key].status !== "completed") {
    progress.days[key].status = "completed";
    progress.totals.completed_days += 1;
  }

  saveProgress(progress);
}

export function markFailure(progress) {
  progress.totals.failed_batches += 1;
  saveProgress(progress);
}

export function markRetry(progress) {
  progress.totals.retries += 1;
  saveProgress(progress);
}

export function markFinished(progress) {
  progress.status = "completed";
  saveProgress(progress);
}

export function getProgressFile() {
  return PROGRESS_FILE;
}
