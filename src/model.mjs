export const SKILLS = [
  "Electrical",
  "Bicycles",
  "Textiles",
  "Furniture",
  "Other",
];
export const OUTCOMES = ["Repaired", "Needs parts", "Not repaired"];
export const LIMITS = Object.freeze({ jobs: 120, volunteers: 12, tools: 12 });

const fail = (message) => {
  throw new Error(message);
};
const isObj = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const str = (value, name, max = 80) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max
    ? value.trim()
    : fail(`${name} must contain 1–${max} characters.`);
const id = (value, name) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value)
    ? value
    : fail(`${name} is invalid.`);
const num = (value, name, min, max) =>
  Number.isInteger(value) && value >= min && value <= max
    ? value
    : fail(`${name} must be a whole number from ${min} to ${max}.`);
const bool = (value, name) =>
  typeof value === "boolean" ? value : fail(`${name} must be true or false.`);
const arr = (value, name, max) =>
  Array.isArray(value) && value.length <= max
    ? value
    : fail(`${name} must be a list of at most ${max} items.`);
const distinct = (values, name) =>
  new Set(values).size === values.length
    ? values
    : fail(`${name} contains duplicate entries.`);
const option = (value, options, name) =>
  options.includes(value) ? value : fail(`${name} is not a supported value.`);

export function timeLabel(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) return "—";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function parseTime(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value))
    throw new Error("Use a time in HH:MM format.");
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) throw new Error("Enter a valid time.");
  return h * 60 + m;
}

export function validateEvent(raw) {
  if (!isObj(raw) || raw.version !== 1)
    fail("This is not a supported BenchDay event (version 1).");
  const event = {
    version: 1,
    id: id(raw.id, "Event ID"),
    revision: num(raw.revision, "Revision", 0, Number.MAX_SAFE_INTEGER),
    name: str(raw.name, "Event name"),
    example: bool(raw.example, "Example flag"),
    now: num(raw.now, "Event time", 0, 1439),
    closes: num(raw.closes, "Closing time", 1, 1439),
    nextTicket: num(raw.nextTicket, "Next ticket", 1, 1000000),
    tools: arr(raw.tools, "Tools", LIMITS.tools).map((t) => {
      if (!isObj(t)) fail("Invalid tool.");
      return {
        id: id(t.id, "Tool ID"),
        name: str(t.name, "Tool name", 50),
        capacity: num(t.capacity, "Tool capacity", 0, 12),
      };
    }),
    volunteers: arr(raw.volunteers, "Volunteers", LIMITS.volunteers).map(
      (v) => {
        if (!isObj(v)) fail("Invalid volunteer.");
        const skills = distinct(
          arr(v.skills, "Skills", SKILLS.length).map((s) =>
            option(s, SKILLS, "Skill"),
          ),
          "Skills",
        );
        if (!skills.length) fail("Each volunteer needs at least one skill.");
        return {
          id: id(v.id, "Volunteer ID"),
          name: str(v.name, "Volunteer name", 50),
          skills,
          available: bool(v.available, "Availability"),
          from: num(v.from, "Shift start", 0, 1438),
          until: num(v.until, "Shift end", 1, 1439),
        };
      },
    ),
    jobs: arr(raw.jobs, "Repairs", LIMITS.jobs).map((j) => {
      if (!isObj(j)) fail("Invalid repair.");
      return {
        id: id(j.id, "Repair ID"),
        ticket: num(j.ticket, "Ticket", 1, 999999),
        item: str(j.item, "Item", 100),
        skill: option(j.skill, SKILLS, "Repair skill"),
        minutes: num(j.minutes, "Repair estimate", 5, 180),
        arrived: num(j.arrived, "Arrival time", 0, 1439),
        tools: distinct(
          arr(j.tools, "Required tools", LIMITS.tools).map((t) =>
            id(t, "Tool reference"),
          ),
          "Required tools",
        ),
        hold:
          typeof j.hold === "string" && j.hold.length <= 160
            ? j.hold.trim()
            : fail("Hold reason is too long."),
        status: option(
          j.status,
          ["waiting", "active", "finished"],
          "Repair status",
        ),
        volunteerId:
          j.volunteerId === null
            ? null
            : id(j.volunteerId, "Assigned volunteer"),
        started:
          j.started === null ? null : num(j.started, "Start time", 0, 1439),
        finished:
          j.finished === null ? null : num(j.finished, "Finish time", 0, 1439),
        outcome:
          j.outcome === null ? null : option(j.outcome, OUTCOMES, "Outcome"),
      };
    }),
  };
  distinct(
    event.tools.map((t) => t.id),
    "Tool IDs",
  );
  distinct(
    event.volunteers.map((v) => v.id),
    "Volunteer IDs",
  );
  distinct(
    event.jobs.map((j) => j.id),
    "Repair IDs",
  );
  distinct(
    event.jobs.map((j) => j.ticket),
    "Tickets",
  );
  const toolIDs = new Set(event.tools.map((t) => t.id));
  const workerIDs = new Set(event.volunteers.map((v) => v.id));
  const usedWorkers = new Set();
  const usedTools = new Map(event.tools.map((t) => [t.id, 0]));
  for (const v of event.volunteers)
    if (v.from >= v.until)
      fail(`${v.name}'s shift must finish after it starts.`);
  for (const j of event.jobs) {
    if (j.arrived > event.now)
      fail(`Ticket ${j.ticket} arrives after the event clock.`);
    if (j.tools.some((t) => !toolIDs.has(t)))
      fail(`Ticket ${j.ticket} refers to a missing tool.`);
    if (j.ticket >= event.nextTicket)
      fail("The next ticket must be greater than every existing ticket.");
    if (j.status === "waiting") {
      if (
        j.volunteerId !== null ||
        j.started !== null ||
        j.finished !== null ||
        j.outcome !== null
      )
        fail(`Waiting ticket ${j.ticket} has an assignment or result.`);
    } else {
      if (
        !workerIDs.has(j.volunteerId) ||
        j.started === null ||
        j.started < j.arrived ||
        j.started > event.now
      )
        fail(`Ticket ${j.ticket} has an invalid assignment or start time.`);
      if (j.hold) fail(`Assigned ticket ${j.ticket} cannot also be on hold.`);
      if (j.status === "active") {
        if (j.finished !== null || j.outcome !== null)
          fail(`Active ticket ${j.ticket} has a finished result.`);
        if (usedWorkers.has(j.volunteerId))
          fail("One volunteer is assigned to more than one active repair.");
        usedWorkers.add(j.volunteerId);
        for (const tool of j.tools)
          usedTools.set(tool, usedTools.get(tool) + 1);
      } else if (
        j.finished === null ||
        j.finished < j.started ||
        j.finished > event.now ||
        j.outcome === null
      )
        fail(`Ticket ${j.ticket} has an invalid finish time or outcome.`);
    }
  }
  for (const tool of event.tools)
    if (usedTools.get(tool.id) > tool.capacity)
      fail(`${tool.name} capacity is below its active use.`);
  return event;
}

export function emptyEvent({
  id: eventId,
  name = "Community repair day",
  now = 600,
  closes = 780,
} = {}) {
  return validateEvent({
    version: 1,
    id: eventId,
    revision: 0,
    name,
    now,
    closes,
    example: false,
    nextTicket: 1,
    tools: [],
    volunteers: [],
    jobs: [],
  });
}

export function demoEvent() {
  const job = (n, item, skill, minutes, tools = [], hold = "") => ({
    id: `repair-${n}`,
    ticket: n,
    item,
    skill,
    minutes,
    tools,
    hold,
    arrived: 560 + n * 4,
    status: "waiting",
    volunteerId: null,
    started: null,
    finished: null,
    outcome: null,
  });
  return validateEvent({
    version: 1,
    id: "example-repair-morning",
    revision: 0,
    name: "Saturday repair morning",
    example: true,
    now: 600,
    closes: 780,
    nextTicket: 8,
    tools: [
      { id: "bike-stand", name: "Bike stand", capacity: 1 },
      { id: "electrical-bench", name: "Electrical bench", capacity: 1 },
      { id: "sewing-machine", name: "Sewing machine", capacity: 1 },
    ],
    volunteers: [
      {
        id: "rowan",
        name: "Rowan",
        skills: ["Bicycles", "Electrical"],
        available: true,
        from: 540,
        until: 780,
      },
      {
        id: "alex",
        name: "Alex",
        skills: ["Bicycles"],
        available: true,
        from: 540,
        until: 780,
      },
      {
        id: "sam",
        name: "Sam",
        skills: ["Textiles"],
        available: true,
        from: 540,
        until: 750,
      },
      {
        id: "jo",
        name: "Jo",
        skills: ["Furniture"],
        available: false,
        from: 600,
        until: 780,
      },
    ],
    jobs: [
      job(1, "City bike · slipping gears", "Bicycles", 30, ["bike-stand"]),
      job(2, "Desk lamp · loose switch", "Electrical", 20, [
        "electrical-bench",
      ]),
      job(3, "Canvas bag · torn seam", "Textiles", 15, ["sewing-machine"]),
      job(4, "Folding chair · loose joint", "Furniture", 25),
      job(5, "Kids’ bike · brake adjustment", "Bicycles", 20, ["bike-stand"]),
      job(
        6,
        "Kettle · intermittent power",
        "Electrical",
        25,
        ["electrical-bench"],
        "Waiting for a safety assessment",
      ),
      job(7, "Jacket · missing button", "Textiles", 10),
    ],
  });
}

// Rebuild every accepted field, including on import. Unknown keys are never merged.
export function addRepair(raw, input) {
  const e = validateEvent(raw);
  const job = {
    id: input.id,
    ticket: e.nextTicket,
    item: input.item,
    skill: input.skill,
    minutes: input.minutes,
    tools: input.tools,
    hold: input.hold || "",
    arrived: e.now,
    status: "waiting",
    volunteerId: null,
    started: null,
    finished: null,
    outcome: null,
  };
  return validateEvent({
    ...e,
    nextTicket: e.nextTicket + 1,
    jobs: [...e.jobs, job],
  });
}

export function editRepair(raw, jobId, input) {
  const e = validateEvent(raw),
    current = e.jobs.find((j) => j.id === jobId);
  if (!current || current.status !== "waiting")
    fail("Only a waiting repair can be edited.");
  return validateEvent({
    ...e,
    jobs: e.jobs.map((j) =>
      j.id === jobId
        ? {
            ...j,
            item: input.item,
            skill: input.skill,
            minutes: input.minutes,
            tools: input.tools,
            hold: input.hold || "",
          }
        : j,
    ),
  });
}

export function finishRepair(raw, jobId, outcome) {
  const e = validateEvent(raw),
    j = e.jobs.find((j) => j.id === jobId);
  if (!j || j.status !== "active") fail("This repair is no longer active.");
  return validateEvent({
    ...e,
    jobs: e.jobs.map((j) =>
      j.id === jobId
        ? { ...j, status: "finished", finished: e.now, outcome }
        : j,
    ),
  });
}

export function updateVolunteer(raw, input) {
  const e = validateEvent(raw),
    existing = e.volunteers.some((v) => v.id === input.id);
  return validateEvent({
    ...e,
    volunteers: existing
      ? e.volunteers.map((v) => (v.id === input.id ? input : v))
      : [...e.volunteers, input],
  });
}

export function updateTool(raw, input) {
  const e = validateEvent(raw),
    existing = e.tools.some((t) => t.id === input.id);
  return validateEvent({
    ...e,
    tools: existing
      ? e.tools.map((t) => (t.id === input.id ? input : t))
      : [...e.tools, input],
  });
}
