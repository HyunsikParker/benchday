import { validateEvent } from "./model.mjs";

export const STORAGE_KEY = "benchday.event.v1";
export const MAX_FILE_BYTES = 300000;
export function readStored(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  if (raw.length > MAX_FILE_BYTES)
    throw new Error(
      "The saved event is too large. Export it for recovery before starting again.",
    );
  try {
    return validateEvent(JSON.parse(raw));
  } catch {
    throw new Error(
      "The saved event could not be read. Your data has not been replaced.",
    );
  }
}

// Synchronous compare-and-write, used only while holding the browser's editor lock.
// An existing malformed event is deliberately not treated as an empty event.
export function saveStored(storage, raw, expected) {
  const current = readStored(storage);
  if (
    (current === null) !== (expected === null) ||
    (current &&
      (current.id !== expected.id || current.revision !== expected.revision))
  ) {
    throw new Error(
      "Another copy changed the saved event. Reload this tab before editing.",
    );
  }
  const event = validateEvent({
    ...raw,
    revision: (current?.revision ?? -1) + 1,
  });
  storage.setItem(STORAGE_KEY, JSON.stringify(event));
  return event;
}

async function digest(text) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function exportSnapshot(raw) {
  const event = validateEvent(raw);
  return JSON.stringify(
    {
      format: "benchday-snapshot-v1",
      sha256: await digest(JSON.stringify(event)),
      event,
    },
    null,
    2,
  );
}

export async function importSnapshot(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_FILE_BYTES
  )
    throw new Error("Choose a BenchDay snapshot smaller than 300 KB.");
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (
    !file ||
    file.format !== "benchday-snapshot-v1" ||
    typeof file.sha256 !== "string"
  )
    throw new Error("Choose a snapshot exported by BenchDay.");
  const event = validateEvent(file.event);
  if ((await digest(JSON.stringify(event))) !== file.sha256)
    throw new Error(
      "The snapshot checksum does not match. The current event has not changed.",
    );
  return event;
}
