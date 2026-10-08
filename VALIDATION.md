# Validation record

Checked on October 8, 2026, using Node.js 22.23.3, Chrome and Aside on macOS. These are local software checks, not a host score or evidence of field impact.

## Automated checks

`npm test` passed all eight tests. One test contains 300 seeded cases compared with an independent exhaustive implementation. The oracle enumerates job-to-volunteer alternatives separately from the production worker-based recursion.

The initial example produces two starts with the fixed-order greedy baseline and three with the dispatcher. Tests also check that active work retains its resources after an estimate elapses, held work is excluded, and shifts, closing time and tool capacities are respected.

Malformed snapshots, changed checksums, duplicate resource references, stale assignments, invalid status transitions, corrupt local storage and failed writes are rejected. Previous event objects remain unchanged.

A separate maximum-size smoke check used 120 waiting repairs and 12 volunteers. The search returned 12 feasible assignments after 150,000 states in approximately 143 ms on this machine. It reported an incomplete search. This single timing measurement is not a cross-device performance guarantee or an optimality proof.

## Browser checks

- The example loads with seven waiting repairs and a three-repair proposal.
- Confirming a batch reserves three volunteers and their tools.
- Advancing the clock does not automatically release those resources.
- Recording an outcome releases its volunteer and tools and adds a repair-log row with the entered time.
- A new item with a safety hold stays out of the proposal.
- Script-like text in an item description appears as literal text.
- Undo removes the test check-in.
- Reducing a tool below its active use shows an error and leaves the event unchanged.
- Escape closes a dialog.
- A second tab shows a read-only banner and disables editing.
- A valid JSON snapshot imports through the file picker and restores the expected event.
- With the local server stopped, a reload opened the cached app and a three-repair batch was saved successfully.
- A 390-pixel viewport presents a single-column board without overlapping the main controls.

Export serialization and re-import are covered by automated tests. Aside downloaded an actual 4,197-byte JSON snapshot. The downloaded file was read back and passed the schema and checksum validator, with seven fictional repairs and revision 0. The Chrome automation did not return a download path, so file evidence comes from the Aside run.

## Limits

No testing with real repair-event attendees has taken place. No accessibility conformance certification, independent security audit, multi-browser matrix or real-world throughput claim is made. A search that reaches its state budget returns a feasible proposal with an explicit uncertainty notice.
