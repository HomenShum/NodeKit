import { mock } from "node:test";

// Replay preserved July pricing/evidence at its observed time. Only these test
// processes load this fixture; production still rejects expired pricing today.
mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-23T00:00:00.000Z") });
