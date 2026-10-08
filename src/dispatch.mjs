import { validateEvent } from "./model.mjs";

export function resources(raw) {
  const e = validateEvent(raw),
    busy = new Set(),
    remaining = new Map(e.tools.map((t) => [t.id, t.capacity]));
  for (const j of e.jobs.filter((j) => j.status === "active")) {
    busy.add(j.volunteerId);
    for (const t of j.tools) remaining.set(t, remaining.get(t) - 1);
  }
  const free = e.volunteers.filter(
    (v) => v.available && !busy.has(v.id) && v.from <= e.now && v.until > e.now,
  );
  return { event: e, busy, remaining, free };
}

function fits(job, volunteer, e) {
  return (
    !job.hold &&
    volunteer.skills.includes(job.skill) &&
    e.now + job.minutes <= Math.min(e.closes, volunteer.until)
  );
}

// Cardinality first, then the lexicographically oldest ticket set; worker IDs break
// equivalent assignment ties. The objective is simultaneous starts, not repairs
// completed, wait-time reduction, or a prediction of real repair duration.
export function dispatch(raw, { nodeLimit = 150000 } = {}) {
  if (!Number.isInteger(nodeLimit) || nodeLimit < 1 || nodeLimit > 2000000)
    throw new Error("Invalid search budget.");
  const { event: e, remaining, free } = resources(raw);
  const waiting = e.jobs
    .filter((j) => j.status === "waiting")
    .sort((a, b) => a.arrived - b.arrived || a.ticket - b.ticket);
  const ranked = new Map(waiting.map((j, i) => [j.id, i]));
  const options = new Map(
    free.map((v) => [
      v.id,
      waiting.filter(
        (j) => fits(j, v, e) && j.tools.every((t) => remaining.get(t) > 0),
      ),
    ]),
  );
  const workers = [...free].sort(
    (a, b) =>
      options.get(a.id).length - options.get(b.id).length ||
      a.id.localeCompare(b.id),
  );
  let best = [],
    bestRanks = [],
    bestKey = "",
    nodes = 0,
    exhausted = false;
  const used = new Set(),
    chosen = [];
  function consider() {
    const ranks = chosen.map((a) => ranked.get(a.jobId)).sort((a, b) => a - b);
    const key = chosen
      .map((a) => `${a.jobId}:${a.volunteerId}`)
      .sort()
      .join("|");
    let better = chosen.length > best.length;
    if (chosen.length === best.length) {
      const differing = ranks.findIndex((r, i) => r !== bestRanks[i]);
      better =
        differing >= 0
          ? ranks[differing] < bestRanks[differing]
          : key < bestKey;
    }
    if (better) {
      best = chosen.map((x) => ({ ...x }));
      bestRanks = ranks;
      bestKey = key;
    }
  }
  function search(i) {
    if (nodes >= nodeLimit) {
      exhausted = true;
      return;
    }
    nodes++;
    consider();
    if (i >= workers.length || chosen.length + workers.length - i < best.length)
      return;
    const v = workers[i];
    for (const j of options.get(v.id)) {
      if (used.has(j.id) || j.tools.some((t) => remaining.get(t) < 1)) continue;
      used.add(j.id);
      for (const t of j.tools) remaining.set(t, remaining.get(t) - 1);
      chosen.push({ jobId: j.id, volunteerId: v.id });
      search(i + 1);
      chosen.pop();
      for (const t of j.tools) remaining.set(t, remaining.get(t) + 1);
      used.delete(j.id);
      if (exhausted) return;
    }
    search(i + 1);
  }
  search(0);
  best.sort((a, b) => ranked.get(a.jobId) - ranked.get(b.jobId));
  return {
    eventId: e.id,
    revision: e.revision,
    at: e.now,
    assignments: best,
    complete: !exhausted,
    nodes,
    nodeLimit,
    objective: "Most simultaneous starts, then the oldest waiting tickets.",
    waiting: waiting
      .filter((j) => !best.some((a) => a.jobId === j.id))
      .map((j) => ({ jobId: j.id, reason: waitingReason(e, j, best) })),
  };
}

export function waitingReason(raw, job, proposed = []) {
  const { event: e, busy, remaining, free } = resources(raw);
  if (job.hold) return job.hold;
  const trained = e.volunteers.filter((v) => v.skills.includes(job.skill));
  if (!trained.length)
    return `No volunteer has ${job.skill.toLowerCase()} listed.`;
  if (e.now + job.minutes > e.closes)
    return "The estimate runs past closing time.";
  if (job.tools.some((t) => e.tools.find((x) => x.id === t).capacity === 0))
    return "A required tool is marked unavailable.";
  if (job.tools.some((t) => remaining.get(t) === 0))
    return "A required tool is still in use.";
  const available = free.filter((v) => v.skills.includes(job.skill));
  if (!available.length) {
    if (trained.every((v) => busy.has(v.id)))
      return "All matching volunteers are working.";
    return "No matching volunteer is on duty and free.";
  }
  if (!available.some((v) => fits(job, v, e)))
    return "The estimate runs past the matching shifts.";
  const proposedWorkers = new Set(proposed.map((a) => a.volunteerId));
  const toolUse = new Map();
  for (const a of proposed) {
    const j = e.jobs.find((j) => j.id === a.jobId);
    for (const t of j.tools) toolUse.set(t, (toolUse.get(t) || 0) + 1);
  }
  if (job.tools.some((t) => (toolUse.get(t) || 0) >= remaining.get(t)))
    return "The proposed batch uses a required tool.";
  if (available.every((v) => proposedWorkers.has(v.id)))
    return "The proposed batch uses the matching volunteers.";
  return "Not in this batch; review the proposal or dispatch again.";
}

export function applyAssignments(raw, proposal) {
  const { event: e, free, remaining } = resources(raw);
  if (
    proposal.eventId !== e.id ||
    proposal.revision !== e.revision ||
    proposal.at !== e.now
  )
    throw new Error("The board changed. Make a fresh proposal.");
  if (
    !Array.isArray(proposal.assignments) ||
    proposal.assignments.length > e.volunteers.length
  )
    throw new Error("Invalid assignment list.");
  const assignedJobs = new Set(),
    assignedWorkers = new Set(),
    map = new Map();
  for (const a of proposal.assignments) {
    const job = e.jobs.find((j) => j.id === a.jobId && j.status === "waiting"),
      worker = free.find((v) => v.id === a.volunteerId);
    if (
      !job ||
      !worker ||
      assignedJobs.has(job.id) ||
      assignedWorkers.has(worker.id) ||
      !fits(job, worker, e) ||
      job.tools.some((t) => remaining.get(t) < 1)
    )
      throw new Error(
        "A proposed assignment is no longer available. Refresh the proposal.",
      );
    assignedJobs.add(job.id);
    assignedWorkers.add(worker.id);
    map.set(job.id, worker.id);
    for (const t of job.tools) remaining.set(t, remaining.get(t) - 1);
  }
  return validateEvent({
    ...e,
    jobs: e.jobs.map((j) =>
      map.has(j.id)
        ? { ...j, status: "active", volunteerId: map.get(j.id), started: e.now }
        : j,
    ),
  });
}

export function firstFit(raw) {
  const { event: e, free, remaining } = resources(raw),
    workers = new Set(),
    assignments = [];
  for (const j of e.jobs
    .filter((j) => j.status === "waiting")
    .sort((a, b) => a.arrived - b.arrived || a.ticket - b.ticket)) {
    const v = free.find((v) => !workers.has(v.id) && fits(j, v, e));
    if (!v || j.tools.some((t) => remaining.get(t) < 1)) continue;
    assignments.push({ jobId: j.id, volunteerId: v.id });
    workers.add(v.id);
    for (const t of j.tools) remaining.set(t, remaining.get(t) - 1);
  }
  return { eventId: e.id, revision: e.revision, at: e.now, assignments };
}
