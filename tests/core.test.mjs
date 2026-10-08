import test from "node:test";
import assert from "node:assert/strict";
import {
  demoEvent,
  validateEvent,
  emptyEvent,
  addRepair,
  editRepair,
  finishRepair,
  updateTool,
  parseTime,
} from "../src/model.mjs";
import {
  dispatch,
  firstFit,
  applyAssignments,
  resources,
} from "../src/dispatch.mjs";
import {
  readStored,
  saveStored,
  exportSnapshot,
  importSnapshot,
  STORAGE_KEY,
} from "../src/storage.mjs";

test("example avoids the greedy skill trap without overusing a tool", () => {
  const e = demoEvent(),
    p = dispatch(e);
  assert.equal(firstFit(e).assignments.length, 2);
  assert.equal(p.assignments.length, 3);
  assert.equal(p.complete, true);
  assert.deepEqual(p.assignments, [
    { jobId: "repair-1", volunteerId: "alex" },
    { jobId: "repair-2", volunteerId: "rowan" },
    { jobId: "repair-3", volunteerId: "sam" },
  ]);
  assert.equal(
    applyAssignments(e, p).jobs.filter((j) => j.status === "active").length,
    3,
  );
  assert.equal(
    e.jobs.every((j) => j.status === "waiting"),
    true,
  );
});

test("active work stays reserved after its estimate; only finish releases resources", () => {
  const e = applyAssignments(demoEvent(), dispatch(demoEvent()));
  e.now += 60;
  assert.equal(resources(e).free.length, 0);
  assert.equal(dispatch(e).assignments.length, 0);
  const next = finishRepair(e, "repair-3", "Needs parts");
  assert.equal(dispatch(next).assignments[0].jobId, "repair-7");
  assert.equal(
    next.jobs.find((j) => j.id === "repair-3").outcome,
    "Needs parts",
  );
});

test("holds, duty flags, shift end and close are hard constraints", () => {
  const e = demoEvent();
  e.closes = 610;
  const p = dispatch(e);
  assert.deepEqual(p.assignments, [{ jobId: "repair-7", volunteerId: "sam" }]);
  e.volunteers.find((v) => v.id === "sam").until = 609;
  assert.equal(dispatch(e).assignments.length, 0);
  const held = demoEvent();
  held.jobs.forEach((j) => (j.hold = "Hold"));
  assert.equal(dispatch(held).assignments.length, 0);
});

test("capacity, duplicate resources, stale batches and arbitrary input are rejected atomically", () => {
  const e = demoEvent(),
    p = dispatch(e);
  assert.throws(() => applyAssignments({ ...e, revision: 1 }, p), /changed/);
  assert.throws(
    () =>
      applyAssignments(e, {
        ...p,
        assignments: [p.assignments[0], p.assignments[0]],
      }),
    /no longer/,
  );
  const started = applyAssignments(e, p);
  assert.throws(
    () => updateTool(started, { id: "bike-stand", name: "Stand", capacity: 0 }),
    /active use/,
  );
  assert.throws(() => editRepair(started, "repair-1", {}), /Only a waiting/);
  assert.throws(
    () => finishRepair(e, "repair-1", "Repaired"),
    /no longer active/,
  );
  const corrupt = structuredClone(e);
  corrupt.jobs[0].tools = ["missing"];
  assert.throws(() => validateEvent(corrupt), /missing tool/);
  const duplicates = structuredClone(e);
  duplicates.jobs[0].tools = ["bike-stand", "bike-stand"];
  assert.throws(() => validateEvent(duplicates), /duplicate/);
  assert.throws(() => parseTime("25:01"), /valid time/);
});

test("a bounded search reports uncertainty instead of claiming optimality", () => {
  const p = dispatch(demoEvent(), { nodeLimit: 1 });
  assert.equal(p.complete, false);
  assert.equal(p.nodes, 1);
  assert.doesNotThrow(() => applyAssignments(demoEvent(), p));
});

// Independent oracle enumerates subsets of job-volunteer pairs, rather than
// sharing the production worker recursion or its feasibility helpers.
function oracle(e) {
  const jobs = e.jobs
    .filter((j) => j.status === "waiting")
    .sort((a, b) => a.arrived - b.arrived || a.ticket - b.ticket);
  const busy = new Set(
    e.jobs.filter((j) => j.status === "active").map((j) => j.volunteerId),
  );
  const base = Object.fromEntries(
    e.tools.map((t) => [
      t.id,
      e.jobs.filter((j) => j.status === "active" && j.tools.includes(t.id))
        .length,
    ]),
  );
  let best = [];
  function walk(i, chosen, workers, use) {
    if (i === jobs.length) {
      const ranks = chosen.map((j) => jobs.indexOf(j));
      if (
        ranks.length > best.length ||
        (ranks.length === best.length &&
          ranks.some(
            (r, k) =>
              r !== best[k] &&
              ranks.slice(0, k).every((x, n) => x === best[n]) &&
              r < best[k],
          ))
      )
        best = ranks;
      return;
    }
    walk(i + 1, chosen, workers, use);
    const j = jobs[i];
    if (
      j.hold ||
      e.now + j.minutes > e.closes ||
      j.tools.some((t) => use[t] >= e.tools.find((x) => x.id === t).capacity)
    )
      return;
    for (const v of e.volunteers) {
      if (
        !v.available ||
        busy.has(v.id) ||
        workers.has(v.id) ||
        v.from > e.now ||
        v.until < e.now + j.minutes ||
        !v.skills.includes(j.skill)
      )
        continue;
      walk(
        i + 1,
        [...chosen, j],
        new Set([...workers, v.id]),
        Object.fromEntries(
          Object.entries(use).map(([k, n]) => [
            k,
            n + Number(j.tools.includes(k)),
          ]),
        ),
      );
    }
  }
  walk(0, [], new Set(), base);
  return best.map((i) => jobs[i].id);
}
test("300 seeded small cases agree with an independent exhaustive oracle", () => {
  let seed = 713;
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % n;
  };
  for (let n = 0; n < 300; n++) {
    let e = emptyEvent({ id: `case-${n}`, now: 600, closes: 630 });
    e.tools = [{ id: "shared", name: "Shared bench", capacity: rand(3) }];
    e.volunteers = Array.from({ length: 1 + rand(3) }, (_, i) => ({
      id: `v${i}`,
      name: `V${i}`,
      skills: rand(2) ? ["Electrical", "Bicycles"] : ["Bicycles"],
      available: rand(4) > 0,
      from: 590 + rand(3) * 10,
      until: 620 + rand(3) * 10,
    }));
    for (let j = 0, count = 1 + rand(5); j < count; j++)
      e = addRepair(e, {
        id: `j${j}`,
        item: `Item ${j}`,
        skill: rand(2) ? "Electrical" : "Bicycles",
        minutes: 5 + rand(4) * 10,
        tools: rand(2) ? ["shared"] : [],
        hold: rand(6) ? "" : "Safety hold",
      });
    const p = dispatch(e);
    assert.equal(p.complete, true);
    assert.deepEqual(
      p.assignments.map((a) => a.jobId),
      oracle(e),
      `case ${n}`,
    );
    assert.doesNotThrow(() => applyAssignments(e, p));
  }
});

test("snapshots round-trip; changed data and oversized/corrupt files do not import", async () => {
  const e = demoEvent(),
    text = await exportSnapshot(e);
  assert.deepEqual(await importSnapshot(text), e);
  const edited = JSON.parse(text);
  edited.event.name = "Changed";
  await assert.rejects(importSnapshot(JSON.stringify(edited)), /checksum/);
  await assert.rejects(importSnapshot("{"), /valid JSON/);
  await assert.rejects(importSnapshot(" ".repeat(300001)), /300 KB/);
});

test("local storage rejects stale writes and preserves corrupted or full storage", () => {
  const values = new Map(),
    storage = {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
    };
  const e = saveStored(storage, demoEvent(), null);
  const newer = saveStored(storage, { ...e, name: "New name" }, e);
  assert.equal(newer.revision, 1);
  assert.throws(() => saveStored(storage, e, e), /Another copy/);
  assert.deepEqual(readStored(storage), newer);
  values.set(STORAGE_KEY, "broken");
  assert.throws(() => saveStored(storage, e, null), /not been replaced/);
  assert.equal(values.get(STORAGE_KEY), "broken");
  values.clear();
  storage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  assert.throws(() => saveStored(storage, e, null), /Quota/);
  assert.equal(readStored(storage), null);
});
