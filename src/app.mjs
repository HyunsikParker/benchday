import {
  SKILLS,
  OUTCOMES,
  LIMITS,
  validateEvent,
  emptyEvent,
  demoEvent,
  addRepair,
  editRepair,
  finishRepair,
  updateVolunteer,
  updateTool,
  timeLabel,
  parseTime,
} from "./model.mjs";
import {
  dispatch,
  applyAssignments,
  resources,
  firstFit,
} from "./dispatch.mjs";
import {
  STORAGE_KEY,
  MAX_FILE_BYTES,
  readStored,
  saveStored,
  exportSnapshot,
  importSnapshot,
} from "./storage.mjs";

const root = document.querySelector("#app"),
  notice = document.querySelector("#notice");
let event = null,
  tab = "board",
  editing = false,
  undo = [],
  proposal = null,
  cacheReady = false,
  cacheFailed = false,
  noticeTimer,
  bootError = null;
const uid = () => crypto.randomUUID();
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (
      ["value", "checked", "disabled", "required", "selected"].includes(key)
    )
      el[key] = value;
    else if (value !== false && value !== null)
      el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined && child !== false)
      el.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return el;
};
const button = (
  label,
  action,
  { kind = "", disabled = false, ...attrs } = {},
) =>
  h(
    "button",
    {
      type: "button",
      class: kind,
      disabled,
      ...attrs,
      onclick: () => guard(action),
    },
    label,
  );
function toast(message, error = false) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.className = `notice visible${error ? " error" : ""}`;
  noticeTimer = setTimeout(
    () => (notice.className = "notice"),
    error ? 12000 : 6500,
  );
}
async function guard(action) {
  try {
    await action();
  } catch (error) {
    toast(error.message, true);
  }
}
function commit(next, message, { remember = true } = {}) {
  if (!editing)
    throw new Error(
      "This tab is read-only. Close the other BenchDay tab, then reload.",
    );
  const before = event;
  const saved = saveStored(localStorage, next, event);
  if (remember && before) {
    undo.push(before);
    if (undo.length > 20) undo.shift();
  }
  event = saved;
  proposal = null;
  render();
  toast(message);
}
function performUndo() {
  const previous = undo.at(-1);
  if (!previous) return;
  commit(previous, "Last change undone.", { remember: false });
  undo.pop();
  render();
}
const ticket = (j) => `#${String(j.ticket).padStart(2, "0")}`;
const toolsLabel = (j) =>
  j.tools.map((id) => event.tools.find((t) => t.id === id).name).join(" · ") ||
  "No shared tool";
const badge = (text, kind = "") => h("span", { class: `badge ${kind}` }, text);
function render() {
  const focused = document.activeElement?.getAttribute("data-focus");
  if (!event) {
    renderRecovery();
    return;
  }
  const p = (proposal ??= dispatch(event)),
    r = resources(event);
  const waiting = event.jobs.filter((j) => j.status === "waiting"),
    active = event.jobs.filter((j) => j.status === "active"),
    finished = event.jobs.filter((j) => j.status === "finished");
  root.replaceChildren(
    h(
      "header",
      { class: "topbar" },
      h(
        "div",
        { class: "brand" },
        h("span", { class: "brand-mark", "aria-hidden": "true" }, "B"),
        "BenchDay",
        h(
          "span",
          { class: "brand-sub" },
          "Repair together. Keep the queue moving.",
        ),
      ),
      h(
        "span",
        { class: "local-badge" },
        h("span", { class: "dot" }),
        editing ? "Saved on this device" : "Read-only tab",
      ),
    ),
    h(
      "main",
      { class: "shell", id: "main", tabindex: "-1" },
      h(
        "div",
        { class: "event-heading" },
        h(
          "div",
          {},
          h("p", { class: "eyebrow" }, "The reception desk"),
          h("h1", {}, event.name),
        ),
        h(
          "div",
          { class: "actions" },
          button("Undo", performUndo, {
            disabled: !editing || !undo.length,
            "data-focus": "undo",
          }),
          button("Export", exportEvent, { "data-focus": "export" }),
          button("Event options", eventOptions, { "data-focus": "options" }),
        ),
      ),
      event.example
        ? h(
            "div",
            { class: "example-banner" },
            h(
              "div",
              {},
              h("strong", {}, "Example event"),
              "Fictional people and repairs. Explore the board, then start your own day.",
            ),
            button("Start a blank event", () => replaceEvent(false), {
              kind: "small",
              disabled: !editing,
            }),
          )
        : null,
      !editing
        ? h(
            "div",
            { class: "example-banner readonly", role: "status" },
            h(
              "div",
              {},
              h("strong", {}, "Another tab has the editor."),
              "This view can export data. Close the other BenchDay tab and reload to take over.",
            ),
            button("Reload", () => location.reload(), { kind: "small" }),
          )
        : null,
      h(
        "div",
        { class: "toolbar" },
        h(
          "nav",
          { class: "tabs", "aria-label": "Event views" },
          ...["board", "people", "history"].map((name) =>
            button(
              {
                board: "Live board",
                people: "People & tools",
                history: "Repair log",
              }[name],
              () => {
                tab = name;
                render();
              },
              {
                kind: "tab",
                "aria-current": tab === name ? "page" : false,
                "data-focus": `tab-${name}`,
              },
            ),
          ),
        ),
        h(
          "div",
          { class: "clock" },
          h("span", { class: "clock-text muted" }, "Event clock"),
          h("time", { class: "mono" }, timeLabel(event.now)),
          h("span", { class: "muted" }, `/ closes ${timeLabel(event.closes)}`),
          button("Set time", clockDialog, {
            kind: "small",
            disabled: !editing,
            "data-focus": "clock",
          }),
        ),
      ),
      h(
        "p",
        { class: "print-title" },
        `${event.example ? "EXAMPLE EVENT · " : ""}Event clock ${timeLabel(event.now)} · Closing ${timeLabel(event.closes)} · ${finished.length} recorded outcomes`,
      ),
      h(
        "div",
        { class: "stats" },
        ...[
          [waiting.length, "waiting"],
          [active.length, "at a bench"],
          [finished.length, "finished"],
          [r.free.length, "volunteers free"],
        ].map(([n, label]) =>
          h(
            "div",
            { class: "stat" },
            h("strong", { class: "mono" }, n),
            h("span", {}, label),
          ),
        ),
      ),
      tab === "board"
        ? boardView(p, r)
        : tab === "people"
          ? peopleView(r)
          : historyView(finished),
      h(
        "footer",
        { class: "footer" },
        h(
          "span",
          {},
          `One event. One editing tab. ${cacheReady ? "Offline copy ready." : cacheFailed ? "Offline copy unavailable. Keep a snapshot backup." : "Preparing offline copy…"}`,
        ),
        h(
          "div",
          {},
          "No accounts or analytics. ",
          button("How BenchDay works", helpDialog, { kind: "quiet" }),
        ),
      ),
    ),
  );
  if (focused)
    root
      .querySelector(`[data-focus="${focused}"]`)
      ?.focus({ preventScroll: true });
}

function boardView(p, r) {
  const waiting = event.jobs
    .filter((j) => j.status === "waiting")
    .sort((a, b) => a.arrived - b.arrived || a.ticket - b.ticket);
  const chosen = new Set(p.assignments.map((a) => a.jobId));
  return h(
    "div",
    {},
    h(
      "div",
      { class: "board-grid" },
      h(
        "section",
        { class: "panel", "aria-labelledby": "queue-title" },
        h(
          "div",
          { class: "panel-head" },
          h(
            "div",
            { class: "panel-title" },
            h("h2", { id: "queue-title" }, "Waiting repairs"),
            h("span", { class: "count" }, waiting.length),
          ),
          button("+ Check in", () => repairDialog(), {
            kind: "small",
            disabled: !editing || event.jobs.length >= LIMITS.jobs,
            "data-focus": "checkin",
          }),
        ),
        waiting.length
          ? h(
              "div",
              {},
              h(
                "div",
                { class: "queue-header", "aria-hidden": "true" },
                h("span", {}, "Ticket"),
                h("span", {}, "Item / what it needs"),
                h("span", {}, "Estimate"),
                h("span", {}, "Status"),
              ),
              h(
                "ol",
                { class: "queue-list" },
                ...waiting.map((j) =>
                  h(
                    "li",
                    { class: "queue-row" },
                    h("span", { class: "ticket mono" }, ticket(j)),
                    h(
                      "div",
                      {},
                      h("p", { class: "item-name" }, j.item),
                      h(
                        "p",
                        { class: "item-meta" },
                        `${j.skill} · ${toolsLabel(j)}`,
                      ),
                      h(
                        "p",
                        { class: `reason${j.hold ? " hold" : ""}` },
                        chosen.has(j.id)
                          ? `Proposed for ${event.volunteers.find((v) => v.id === p.assignments.find((a) => a.jobId === j.id).volunteerId).name}`
                          : p.waiting.find((x) => x.jobId === j.id)?.reason,
                      ),
                    ),
                    h(
                      "div",
                      { class: "estimate mono" },
                      `${j.minutes} min`,
                      h("span", {}, `In ${timeLabel(j.arrived)}`),
                    ),
                    h(
                      "div",
                      { class: "row-action" },
                      badge(
                        j.hold
                          ? "On hold"
                          : chosen.has(j.id)
                            ? "Next batch"
                            : "Waiting",
                        j.hold ? "hold" : chosen.has(j.id) ? "ready" : "",
                      ),
                      button("Edit", () => repairDialog(j), {
                        kind: "small quiet",
                        disabled: !editing,
                        "aria-label": `Edit ticket ${j.ticket}`,
                        "data-focus": `edit-${j.id}`,
                      }),
                    ),
                  ),
                ),
              ),
            )
          : h(
              "div",
              { class: "empty" },
              h("strong", {}, "Ready for the first arrival."),
              "Check in an item, choose a skill and note any tools it needs.",
            ),
        h(
          "div",
          { class: "queue-footer" },
          "People confirm safety and estimates. A hold keeps an item out of every proposal.",
        ),
      ),
      h(
        "aside",
        { class: "panel proposal", "aria-labelledby": "proposal-title" },
        h(
          "div",
          { class: "panel-head" },
          h("h2", { id: "proposal-title" }, "Next batch"),
        ),
        h(
          "div",
          { class: "proposal-body" },
          h(
            "p",
            { class: "proposal-intro" },
            "A shared plan for the volunteers and tools available now.",
          ),
          h(
            "div",
            { class: "proposal-summary" },
            h(
              "strong",
              { class: "proposal-number mono" },
              p.assignments.length,
            ),
            h(
              "p",
              {},
              p.assignments.length === 1
                ? "repair can start now"
                : p.assignments.length
                  ? "repairs can start together"
                  : "repairs can start with the current settings",
            ),
          ),
          !p.complete
            ? h(
                "p",
                { class: "incomplete" },
                "Search limit reached. These assignments are feasible, but the best batch and oldest-ticket tie-break are not proven.",
              )
            : null,
          h(
            "ol",
            {},
            ...p.assignments.map((a) => {
              const j = event.jobs.find((j) => j.id === a.jobId),
                v = event.volunteers.find((v) => v.id === a.volunteerId);
              return h(
                "li",
                { class: "assignment" },
                h(
                  "div",
                  { class: "assignment-top" },
                  h("strong", {}, v.name),
                  h(
                    "span",
                    { class: "mono" },
                    `${ticket(j)} · ${j.minutes} min`,
                  ),
                ),
                h("p", { class: "assignment-item" }, j.item),
              );
            }),
          ),
          button(
            p.assignments.length
              ? `Start ${p.assignments.length} repair${p.assignments.length === 1 ? "" : "s"}`
              : "No repairs ready",
            () => startBatch(p),
            {
              kind: "primary full",
              disabled: !editing || !p.assignments.length,
              "data-focus": "start",
            },
          ),
          h(
            "p",
            { class: "proposal-note" },
            p.assignments.length
              ? "Review with the volunteers before starting. Estimates do not release a busy bench."
              : "Check holds, duty status, shared tools and the event clock.",
          ),
          h(
            "details",
            { class: "explain" },
            h("summary", {}, "Why this batch?"),
            h(
              "p",
              {},
              "First, start the most repairs at once. For equally sized batches, prefer the oldest waiting tickets. The plan respects skills, shifts, closing time and shared tools.",
            ),
            h(
              "p",
              {},
              `This search visited ${p.nodes.toLocaleString()} states. ${p.complete ? "The search finished." : "The search stopped at its limit."} It does not predict completion or promise shorter waits.`,
            ),
            event.example
              ? h(
                  "p",
                  {},
                  `In this fictional state, a fixed volunteer-order, oldest-first baseline starts ${firstFit(event).assignments.length}; this proposal starts ${p.assignments.length}. This is a software example, not a measured event outcome.`,
                )
              : null,
          ),
        ),
      ),
    ),
    h(
      "section",
      { class: "work-section", "aria-labelledby": "bench-title" },
      h(
        "div",
        { class: "section-head" },
        h("h2", { id: "bench-title" }, "At the benches"),
        h(
          "span",
          { class: "muted" },
          "Work stays active until someone records an outcome.",
        ),
      ),
      event.volunteers.length
        ? h(
            "div",
            { class: "benches" },
            ...event.volunteers.map((v) => {
              const j = event.jobs.find(
                  (j) => j.status === "active" && j.volunteerId === v.id,
                ),
                free = r.free.some((x) => x.id === v.id);
              return h(
                "article",
                { class: `bench${j ? " active" : ""}` },
                h(
                  "div",
                  { class: "bench-top" },
                  h("h3", {}, v.name),
                  badge(
                    j ? "Working" : free ? "Available" : "Off duty",
                    j || free ? "ready" : "",
                  ),
                ),
                j
                  ? h("p", { class: "item-name" }, `${ticket(j)} ${j.item}`)
                  : h("p", { class: "muted" }, v.skills.join(" · ")),
                h(
                  "p",
                  { class: "muted" },
                  j
                    ? `Started ${timeLabel(j.started)} · ${j.minutes} min estimate`
                    : `Shift ${timeLabel(v.from)}–${timeLabel(v.until)}`,
                ),
                j
                  ? button("Record outcome", () => outcomeDialog(j), {
                      kind: "small",
                      disabled: !editing,
                      "data-focus": `finish-${j.id}`,
                    })
                  : button("Edit volunteer", () => volunteerDialog(v), {
                      kind: "small quiet",
                      disabled: !editing,
                    }),
              );
            }),
          )
        : h(
            "div",
            { class: "panel empty" },
            h("strong", {}, "Add your volunteer team."),
            "Open People & tools to enter skills and shifts.",
          ),
      h(
        "div",
        { class: "tools-strip" },
        h("span", {}, "SHARED TOOLS"),
        ...event.tools.map((t) =>
          h(
            "span",
            {},
            h("strong", {}, `${r.remaining.get(t.id)}/${t.capacity}`),
            ` ${t.name} free`,
          ),
        ),
      ),
    ),
  );
}

function peopleView(r) {
  return h(
    "div",
    { class: "setup-grid" },
    h(
      "section",
      { class: "panel" },
      h(
        "div",
        { class: "panel-head" },
        h("h2", {}, "Volunteers"),
        button("+ Add volunteer", () => volunteerDialog(), {
          kind: "small",
          disabled: !editing || event.volunteers.length >= LIMITS.volunteers,
        }),
      ),
      event.volunteers.length
        ? h(
            "ul",
            { class: "setup-list" },
            ...event.volunteers.map((v) =>
              h(
                "li",
                { class: "setup-row" },
                h(
                  "div",
                  {},
                  h("strong", {}, v.name),
                  " ",
                  badge(
                    r.busy.has(v.id)
                      ? "Working"
                      : v.available
                        ? "On duty"
                        : "Off duty",
                    v.available ? "ready" : "",
                  ),
                  h("p", { class: "muted" }, v.skills.join(" · ")),
                  h(
                    "p",
                    { class: "muted" },
                    `${timeLabel(v.from)}–${timeLabel(v.until)}`,
                  ),
                ),
                button("Edit", () => volunteerDialog(v), {
                  kind: "small",
                  disabled: !editing,
                  "aria-label": `Edit ${v.name}`,
                }),
              ),
            ),
          )
        : h(
            "div",
            { class: "empty" },
            "Add a name or nickname, skills and a shift.",
          ),
      h(
        "div",
        { class: "queue-footer" },
        `Up to ${LIMITS.volunteers} volunteers. “Off duty” blocks new assignments; active work stays reserved.`,
      ),
    ),
    h(
      "section",
      { class: "panel" },
      h(
        "div",
        { class: "panel-head" },
        h("h2", {}, "Shared tools"),
        button("+ Add tool", () => toolDialog(), {
          kind: "small",
          disabled: !editing || event.tools.length >= LIMITS.tools,
        }),
      ),
      event.tools.length
        ? h(
            "ul",
            { class: "setup-list" },
            ...event.tools.map((t) =>
              h(
                "li",
                { class: "setup-row" },
                h(
                  "div",
                  {},
                  h("strong", {}, t.name),
                  h(
                    "p",
                    { class: "muted" },
                    `${r.remaining.get(t.id)} free of ${t.capacity} · one unit per assigned repair`,
                  ),
                ),
                button("Edit", () => toolDialog(t), {
                  kind: "small",
                  disabled: !editing,
                  "aria-label": `Edit ${t.name}`,
                }),
              ),
            ),
          )
        : h(
            "div",
            { class: "empty" },
            "Add the tools or workstations that repairs share.",
          ),
      h(
        "div",
        { class: "queue-footer" },
        "Set capacity to 0 to stop new use. Capacity cannot drop below active use.",
      ),
    ),
  );
}

function historyView(finished) {
  return h(
    "section",
    { class: "panel" },
    h(
      "div",
      { class: "panel-head" },
      h("h2", {}, "Recorded outcomes"),
      button("Print repair log", () => window.print(), {
        kind: "small",
        disabled: !finished.length,
      }),
    ),
    finished.length
      ? h(
          "div",
          { class: "scroll-table" },
          h(
            "table",
            { class: "history-table" },
            h(
              "thead",
              {},
              h(
                "tr",
                {},
                ...[
                  "Ticket / item",
                  "Volunteer",
                  "Started / finished",
                  "Outcome",
                ].map((x) => h("th", { scope: "col" }, x)),
              ),
            ),
            h(
              "tbody",
              {},
              ...finished
                .sort((a, b) => b.finished - a.finished || b.ticket - a.ticket)
                .map((j) =>
                  h(
                    "tr",
                    {},
                    h(
                      "td",
                      {},
                      h("strong", {}, `${ticket(j)} ${j.item}`),
                      h("p", { class: "muted" }, j.skill),
                    ),
                    h(
                      "td",
                      {},
                      event.volunteers.find((v) => v.id === j.volunteerId).name,
                    ),
                    h(
                      "td",
                      { class: "mono" },
                      `${timeLabel(j.started)} / ${timeLabel(j.finished)}`,
                    ),
                    h(
                      "td",
                      {},
                      badge(j.outcome, j.outcome === "Repaired" ? "ready" : ""),
                    ),
                  ),
                ),
            ),
          ),
        )
      : h(
          "div",
          { class: "empty" },
          h("strong", {}, "No outcomes yet."),
          "Start a batch from the live board, then record what happened at each bench.",
        ),
    h(
      "div",
      { class: "queue-footer" },
      "Only outcomes entered by the event operator appear here. Estimates are not results.",
    ),
  );
}

function modal(title, build, { submitLabel = "Save", onSubmit = null } = {}) {
  const opener = document.activeElement;
  const dialog = h("dialog", { "aria-labelledby": "dialog-title" }),
    form = h("form", {}),
    error = h("p", { class: "form-error", role: "alert" });
  const close = () => {
    dialog.close();
    dialog.remove();
    if (opener?.isConnected) opener.focus();
    else root.querySelector("#main")?.focus({ preventScroll: true });
  };
  form.append(
    h(
      "div",
      { class: "dialog-head" },
      h("h2", { id: "dialog-title" }, title),
      button("×", close, { kind: "quiet", "aria-label": "Close dialog" }),
    ),
    h("div", { class: "dialog-content" }, build),
    error,
    h(
      "div",
      { class: "dialog-actions" },
      button(onSubmit ? "Cancel" : "Close", close),
      onSubmit
        ? h("button", { type: "submit", class: "primary" }, submitLabel)
        : null,
    ),
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!onSubmit) return;
    try {
      await onSubmit(new FormData(form));
      close();
    } catch (e) {
      error.textContent = e.message;
    }
  });
  dialog.addEventListener("cancel", (ev) => {
    ev.preventDefault();
    close();
  });
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
const field = (label, input, help = "") =>
  h(
    "label",
    { class: "field" },
    label,
    input,
    help ? h("span", { class: "help" }, help) : null,
  );
const input = (name, value, attrs = {}) =>
  h("input", { name, value, ...attrs });
const select = (name, value, options) =>
  h(
    "select",
    { name },
    ...options.map((x) => h("option", { value: x, selected: x === value }, x)),
  );
const checks = (legend, name, options, values) =>
  h(
    "fieldset",
    { class: "check-group" },
    h("legend", {}, legend),
    h(
      "div",
      { class: "checks" },
      ...options.map(([id, label]) =>
        h(
          "label",
          { class: "check" },
          input(name, id, { type: "checkbox", checked: values.includes(id) }),
          label,
        ),
      ),
    ),
  );

function repairDialog(j) {
  modal(
    j ? `Edit ticket ${j.ticket}` : "Check in a repair",
    [
      h(
        "p",
        {},
        "Describe the item, not the visitor. A volunteer should confirm the estimate and any safety concerns.",
      ),
      field(
        "Item / issue",
        input("item", j?.item || "", {
          required: true,
          maxlength: 100,
          placeholder: "e.g. Desk lamp · loose switch",
          autocomplete: "off",
        }),
      ),
      h(
        "div",
        { class: "form-grid" },
        field("Skill", select("skill", j?.skill || SKILLS[0], SKILLS)),
        field(
          "Estimated minutes",
          input("minutes", j?.minutes || 20, {
            type: "number",
            min: 5,
            max: 180,
            step: 1,
            required: true,
          }),
        ),
      ),
      checks(
        "Shared tools · one of each selected",
        "tools",
        event.tools.map((t) => [t.id, t.name]),
        j?.tools || [],
      ),
      field(
        "Hold reason · optional",
        h(
          "textarea",
          {
            name: "hold",
            maxlength: 160,
            placeholder: "e.g. Waiting for a safety assessment",
          },
          j?.hold || "",
        ),
        "Any hold excludes this repair from dispatch. Clear it only after a person has reviewed the issue.",
      ),
    ],
    {
      submitLabel: j ? "Save repair" : "Add to queue",
      onSubmit: (fd) => {
        const data = {
          id: j?.id || uid(),
          item: fd.get("item"),
          skill: fd.get("skill"),
          minutes: Number(fd.get("minutes")),
          tools: fd.getAll("tools"),
          hold: fd.get("hold"),
        };
        commit(
          j ? editRepair(event, j.id, data) : addRepair(event, data),
          j
            ? `Ticket ${j.ticket} updated.`
            : `Ticket ${event.nextTicket} checked in.`,
        );
      },
    },
  );
}

function volunteerDialog(v) {
  modal(
    v ? "Edit volunteer" : "Add volunteer",
    [
      field(
        "Name or nickname",
        input("name", v?.name || "", {
          required: true,
          maxlength: 50,
          autocomplete: "off",
        }),
      ),
      checks(
        "Skills",
        "skills",
        SKILLS.map((s) => [s, s]),
        v?.skills || [],
      ),
      h(
        "div",
        { class: "form-grid" },
        field(
          "Shift starts",
          input("from", timeLabel(v?.from ?? event.now), {
            type: "time",
            required: true,
          }),
        ),
        field(
          "Shift ends",
          input("until", timeLabel(v?.until ?? event.closes), {
            type: "time",
            required: true,
          }),
        ),
      ),
      h(
        "label",
        { class: "check" },
        input("available", "yes", {
          type: "checkbox",
          checked: v?.available ?? true,
        }),
        "On duty for new assignments",
      ),
      h(
        "p",
        { class: "muted" },
        "Changing a shift or duty status does not release an active repair.",
      ),
    ],
    {
      onSubmit: (fd) =>
        commit(
          updateVolunteer(event, {
            id: v?.id || uid(),
            name: fd.get("name"),
            skills: fd.getAll("skills"),
            available: fd.has("available"),
            from: parseTime(fd.get("from")),
            until: parseTime(fd.get("until")),
          }),
          "Volunteer saved.",
        ),
    },
  );
}

function toolDialog(t) {
  modal(
    t ? "Edit shared tool" : "Add shared tool",
    [
      field(
        "Tool or workstation name",
        input("name", t?.name || "", { required: true, maxlength: 50 }),
      ),
      field(
        "Total units",
        input("capacity", t?.capacity ?? 1, {
          type: "number",
          min: 0,
          max: 12,
          step: 1,
          required: true,
        }),
        "A repair reserves one unit of every tool selected at check-in. Set 0 to mark unavailable.",
      ),
    ],
    {
      onSubmit: (fd) =>
        commit(
          updateTool(event, {
            id: t?.id || uid(),
            name: fd.get("name"),
            capacity: Number(fd.get("capacity")),
          }),
          "Shared tool saved.",
        ),
    },
  );
}

function clockDialog() {
  modal(
    "Set the event clock",
    [
      h(
        "p",
        {},
        "BenchDay uses a manual, same-day clock. Set the current event time before check-in, dispatch or recording an outcome. It does not follow the computer clock.",
      ),
      h(
        "div",
        { class: "form-grid" },
        field(
          "Current event time",
          input("now", timeLabel(event.now), { type: "time", required: true }),
        ),
        field(
          "Closing time",
          input("closes", timeLabel(event.closes), {
            type: "time",
            required: true,
          }),
        ),
      ),
      h(
        "p",
        {},
        "Time can move forward. Active repairs remain reserved even when their estimate or shift has ended.",
      ),
    ],
    {
      onSubmit: (fd) => {
        const now = parseTime(fd.get("now"));
        if (now < event.now)
          throw new Error(
            "The event clock cannot move backward. Use Undo to reverse your last change.",
          );
        commit(
          validateEvent({ ...event, now, closes: parseTime(fd.get("closes")) }),
          "Event clock updated.",
        );
      },
    },
  );
}

function startBatch(p) {
  modal(
    "Confirm the next batch",
    [
      h(
        "p",
        {},
        `Start ${p.assignments.length} repairs at ${timeLabel(event.now)}. Confirm the assignments and safety of the work with the volunteers first.`,
      ),
      h(
        "ul",
        {},
        ...p.assignments.map((a) => {
          const j = event.jobs.find((j) => j.id === a.jobId),
            v = event.volunteers.find((v) => v.id === a.volunteerId);
          return h("li", {}, `${v.name}: ${ticket(j)} ${j.item}`);
        }),
      ),
      h(
        "p",
        {},
        "Each volunteer and shared tool will stay reserved until you record an outcome.",
      ),
    ],
    {
      submitLabel: "Confirm & start",
      onSubmit: () =>
        commit(
          applyAssignments(event, p),
          "Batch started. Volunteers and tools are reserved.",
        ),
    },
  );
}

function outcomeDialog(j) {
  modal(
    `Record outcome · ${ticket(j)}`,
    [
      h("p", {}, j.item),
      field("Outcome", select("outcome", OUTCOMES[0], OUTCOMES)),
      h(
        "p",
        {},
        `Finish time: ${timeLabel(event.now)} on the event clock. If needed, cancel and set the time first. Recording an outcome releases the volunteer and shared tools.`,
      ),
    ],
    {
      submitLabel: "Record outcome",
      onSubmit: (fd) =>
        commit(
          finishRepair(event, j.id, fd.get("outcome")),
          "Outcome recorded. The bench is available again.",
        ),
    },
  );
}

async function exportEvent() {
  download(
    await exportSnapshot(event),
    `benchday-${event.id}-r${event.revision}.json`,
    "application/json",
  );
  toast("Snapshot download requested. Check your browser’s downloads.");
}
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function eventOptions() {
  modal("Event options", [
    h(
      "div",
      { class: "actions" },
      button(
        "Edit event name",
        () => {
          document.querySelector("dialog")?.close();
          document.querySelector("dialog")?.remove();
          nameDialog();
        },
        { disabled: !editing },
      ),
      button(
        "Load example",
        () => {
          document.querySelector("dialog")?.close();
          document.querySelector("dialog")?.remove();
          replaceEvent(true);
        },
        { disabled: !editing },
      ),
    ),
    h(
      "p",
      { class: "muted" },
      "Export your event before replacing it or moving to another device. Snapshots contain volunteer names and item descriptions; they are not encrypted.",
    ),
    h(
      "label",
      { class: "field" },
      "Import a BenchDay snapshot",
      h("input", {
        class: "file-input",
        type: "file",
        accept: ".json,application/json",
        disabled: !editing,
        onchange: (ev) =>
          guard(async () => {
            const file = ev.target.files[0];
            if (!file) return;
            if (file.size > MAX_FILE_BYTES)
              throw new Error("Choose a snapshot smaller than 300 KB.");
            const restored = await importSnapshot(await file.text());
            if (
              !confirm(
                `Replace the current event with “${restored.name}”? Export the current event first if you need to keep it.`,
              )
            ) {
              ev.target.value = "";
              return;
            }
            commit(restored, "Snapshot restored.");
            document.querySelector("dialog")?.close();
            document.querySelector("dialog")?.remove();
          }),
      }),
    ),
    h(
      "p",
      { class: "muted" },
      "The checksum catches accidental changes to a snapshot. It is not a signature or a security guarantee.",
    ),
    button(
      "Start a blank event",
      () => {
        document.querySelector("dialog")?.close();
        document.querySelector("dialog")?.remove();
        replaceEvent(false);
      },
      { disabled: !editing },
    ),
  ]);
}
function nameDialog() {
  modal(
    "Edit event name",
    field(
      "Event name",
      input("name", event.name, { required: true, maxlength: 80 }),
    ),
    {
      onSubmit: (fd) =>
        commit(
          validateEvent({ ...event, name: fd.get("name") }),
          "Event name updated.",
        ),
    },
  );
}
function replaceEvent(example) {
  if (!editing) return;
  if (
    !confirm(
      "Replace this event? Export a snapshot first if you need to keep it.",
    )
  )
    return;
  commit(
    example ? demoEvent() : emptyEvent({ id: uid() }),
    example
      ? "Example loaded."
      : "Blank event created. Add volunteers and tools to begin.",
  );
  tab = example ? "board" : "people";
  render();
}
function helpDialog() {
  modal(
    "How BenchDay works",
    h(
      "div",
      { class: "help-copy" },
      h(
        "p",
        {},
        "BenchDay is a reception tool for a small, single-day repair event. Use one device and one editing tab.",
      ),
      h(
        "ul",
        {},
        h(
          "li",
          {},
          "Add volunteers, their skills and shifts, then the tools they share.",
        ),
        h(
          "li",
          {},
          "Check in an item. Ask a volunteer for an estimate and flag any safety concern as a hold.",
        ),
        h(
          "li",
          {},
          "Set the event clock, review the next batch, then confirm it with the team.",
        ),
        h(
          "li",
          {},
          "Record an outcome when work stops. Only that action releases the volunteer and tools.",
        ),
      ),
      h(
        "p",
        {},
        "The dispatcher maximizes simultaneous starts, then favors the oldest waiting tickets. It is a bounded search; a warning appears if optimality is not proven. Estimated durations are human inputs, not predictions.",
      ),
      h(
        "p",
        {},
        "Event data stays in this browser’s local storage. It is not encrypted or backed up automatically. Use nicknames and avoid contact, medical or other sensitive details. Export regularly; clearing browser data removes the event.",
      ),
      location.hostname.endsWith("github.io")
        ? h(
            "p",
            {},
            "This copy is hosted on GitHub Pages. GitHub logs visitors’ IP addresses for security. BenchDay does not send your event contents to GitHub. ",
            h(
              "a",
              {
                href: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
              },
              "GitHub privacy statement",
            ),
          )
        : null,
      h(
        "p",
        {},
        "A cached app can reopen offline in this browser at the same address after the first complete load. Private browsing, storage settings and cache eviction can prevent this. Keep a JSON snapshot as your backup.",
      ),
      h(
        "p",
        {},
        "Limits: 120 repairs, 12 volunteers and 12 tool types. One unit of each chosen tool per repair. No multi-device sync, overnight events, automatic diagnosis or safety certification.",
      ),
    ),
  );
}

function renderRecovery() {
  root.replaceChildren(
    h(
      "main",
      { class: "shell" },
      h("h1", {}, "Your saved event needs attention"),
      h(
        "p",
        { class: "empty" },
        bootError || "BenchDay could not open local storage.",
      ),
      h(
        "div",
        { class: "actions" },
        button("Export saved data as-is", () =>
          download(
            localStorage.getItem(STORAGE_KEY) || "",
            "benchday-recovery.txt",
            "text/plain",
          ),
        ),
        button(
          "Reset after backing up",
          () => {
            if (!editing)
              throw new Error(
                "Close other BenchDay tabs and reload before resetting.",
              );
            if (
              !confirm(
                "Delete the unreadable event and load the example? Export the saved data first.",
              )
            )
              return;
            localStorage.removeItem(STORAGE_KEY);
            event = saveStored(localStorage, demoEvent(), null);
            bootError = null;
            render();
          },
          { kind: "danger", disabled: !editing },
        ),
      ),
      h(
        "p",
        { class: "empty" },
        "No saved data has been replaced. Storage must be available to edit an event.",
      ),
    ),
  );
}

async function boot() {
  try {
    event = readStored(localStorage);
  } catch (error) {
    bootError = error.message;
  }
  if (!navigator.locks) {
    bootError =
      "This browser cannot provide the single-editor lock. Use a current Chrome, Edge, Firefox or Safari at localhost or over HTTPS.";
    renderRecovery();
    return;
  }
  navigator.locks
    .request("benchday-editor-v1", { ifAvailable: true }, async (lock) => {
      editing = Boolean(lock);
      if (!event && !bootError) {
        if (editing) {
          try {
            event = saveStored(localStorage, demoEvent(), null);
          } catch (error) {
            bootError = error.message;
          }
        } else {
          event = demoEvent();
        }
      }
      render();
      if (lock) await new Promise(() => {});
    })
    .catch((error) => {
      bootError = error.message;
      renderRecovery();
    });
  window.addEventListener("storage", (ev) => {
    if (ev.key !== STORAGE_KEY || editing) return;
    try {
      event = readStored(localStorage);
      proposal = null;
      render();
    } catch (error) {
      bootError = error.message;
      event = null;
      render();
    }
  });
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
      await navigator.serviceWorker.ready;
      cacheReady = true;
      if (event) render();
    } catch {
      cacheReady = false;
      cacheFailed = true;
      if (event) render();
    }
  } else {
    cacheFailed = true;
    if (event) render();
  }
}
boot();
