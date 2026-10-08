# BenchDay demo transcript

This narrated walkthrough uses still captures from the running prototype, fictional event data and the macOS Samantha synthetic voice. It is not a recording of a real repair event.

## 1. A repair morning, on one screen

Bench Day is a reception board for a small community repair event. This walkthrough uses fictional people and repairs in the running app. Seven items are waiting, and three volunteers are available. The next batch turns those separate lists into a shared plan.

## 2. Skills, shifts and shared tools

Each volunteer has skills, a shift, and a duty status. Rowan can repair bicycles and electrical items. Alex handles bicycles, and Sam handles textiles. The bike stand, electrical bench, and sewing machine each have one available unit. Jo is off duty.

## 3. The assignment matters

Giving the first bicycle to Rowan would leave Alex idle and the lamp waiting. In this example, that greedy baseline starts two repairs. Bench Day assigns Alex to the bicycle, Rowan to the lamp, and Sam to the bag, starting three. This is a software example, not measured field impact. The safety hold keeps the kettle out.

## 4. People confirm the work

The operator reviews the batch with the volunteers before confirming it. The app checks skills, shifts, closing time, and shared tools again. People remain responsible for safety and for the estimates they enter.

## 5. Busy means reserved

After confirmation, three repairs are active. The other bicycle waits because its stand is in use. The jacket waits because Sam is working. Those resources stay reserved until someone records an outcome, even if the estimated time has passed.

## 6. Set the event time

The event clock is manual. Here it moves from ten o clock to ten twenty. Reception should set it before check-in, dispatch, and outcome recording. Advancing the clock does not mark any repair finished.

## 7. Record what actually happened

Sam has finished the bag. The operator can record repaired, needs parts, or not repaired. This example records repaired at ten twenty. That explicit result releases Sam and the sewing machine.

## 8. The next item becomes available

The proposal updates immediately. Sam can now take the jacket, while the bicycle and electrical bench remain busy. The kettle is still on hold. Explanations beside each waiting item show what is preventing its assignment.

## 9. Keep outcomes separate from estimates

The repair log shows the bag, its volunteer, the start and finish times, and the recorded outcome. It can be printed for the event record. An estimate is never counted as a completed repair.

## 10. Keep control of the event data

Event data stays in this browser. A second tab is read-only. JSON snapshots can be exported and validated on import. The cached app was also checked with its local server stopped. Backups are not encrypted, so use nicknames and avoid sensitive details.

## 11. A tested prototype, ready to inspect

Eight tests pass, including three hundred small cases compared with an independent exhaustive oracle. A search-limit warning appears if the best batch is not proven. Codex assisted the implementation, tests, and documentation. The next step is testing these assumptions with a real event organizer.
