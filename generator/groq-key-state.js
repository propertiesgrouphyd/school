import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, "data", "groq-key-state.json");

const DEFAULT_STATE = {
  active_key_index: 0,
  updated_at: null
};

function ensureDirectory() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
}

export function loadKeyState() {
  ensureDirectory();

  if (!fs.existsSync(STATE_FILE)) {
    return { ...DEFAULT_STATE };
  }

  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

    const index = Number(data.active_key_index);

    if (index !== 0 && index !== 1) {
      return { ...DEFAULT_STATE };
    }

    return {
      active_key_index: index,
      updated_at: data.updated_at ?? null
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveKeyState(activeKeyIndex) {
  ensureDirectory();

  const state = {
    active_key_index: activeKeyIndex,
    updated_at: new Date().toISOString()
  };

  const tempFile = `${STATE_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(state, null, 2),
    "utf8"
  );

  fs.renameSync(tempFile, STATE_FILE);
}

export function resetKeyState() {
  saveKeyState(0);
}

export function getKeyStateFile() {
  return STATE_FILE;
}
