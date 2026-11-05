const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveProcessingBoundary,
  walkMessagesBackwards,
  createSerialQueue,
} = require("./wordleHistory");

function createChannel(totalMessages) {
  const messages = Array.from({ length: totalMessages }, (_, index) => ({
    id: String(index + 1),
  }));

  return {
    messages: {
      async fetch({ limit, before } = {}) {
        const page = messages
          .filter((message) => !before || BigInt(message.id) < BigInt(before))
          .sort((left, right) => (BigInt(left.id) > BigInt(right.id) ? -1 : 1))
          .slice(0, limit);
        return new Map(page.map((message) => [message.id, message]));
      },
    },
  };
}

test("incremental processing ignores desde_id and resumes after the saved checkpoint", () => {
  assert.deepEqual(
    resolveProcessingBoundary({
      recalculate: false,
      startFromId: "200",
      savedCheckpointId: "150",
    }),
    { checkpointId: "150", includeCheckpoint: false },
  );
});

test("recalculation uses desde_id as an inclusive boundary", () => {
  assert.deepEqual(
    resolveProcessingBoundary({
      recalculate: true,
      startFromId: "200",
      savedCheckpointId: "150",
    }),
    { checkpointId: "200", includeCheckpoint: true },
  );
});

test("recalculation without desde_id reads all available history", () => {
  assert.deepEqual(
    resolveProcessingBoundary({
      recalculate: true,
      startFromId: null,
      savedCheckpointId: "150",
    }),
    { checkpointId: null, includeCheckpoint: false },
  );
});

test("walks all pages once with chronological order within each page", async () => {
  const visited = [];
  const result = await walkMessagesBackwards(createChannel(250), null, (page) => {
    const ids = page.map((message) => Number(message.id));
    assert.deepEqual(ids, [...ids].sort((left, right) => left - right));
    visited.push(...ids);
  });

  assert.equal(result.batchCount, 3);
  assert.equal(result.totalFetched, 250);
  assert.equal(result.newestMessageId, "250");
  assert.deepEqual(
    visited.sort((left, right) => left - right),
    Array.from({ length: 250 }, (_, index) => index + 1),
  );
});

test("includes the checkpoint and stops without visiting older messages", async () => {
  const visited = [];
  const result = await walkMessagesBackwards(
    createChannel(250),
    "40",
    (page) => visited.push(...page.map((message) => Number(message.id))),
    true,
  );

  assert.equal(result.batchCount, 3);
  assert.equal(result.totalFetched, 250);
  assert.deepEqual(
    visited.sort((left, right) => left - right),
    Array.from({ length: 211 }, (_, index) => index + 40),
  );
});

test("excludes a persisted checkpoint during incremental processing", async () => {
  const visited = [];
  await walkMessagesBackwards(createChannel(250), "40", (page) => {
    visited.push(...page.map((message) => Number(message.id)));
  });

  assert.deepEqual(
    visited.sort((left, right) => left - right),
    Array.from({ length: 210 }, (_, index) => index + 41),
  );
});

test("serial queue prevents overlap and continues after a failed task", async () => {
  const enqueue = createSerialQueue();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = enqueue(async () => {
    events.push("first-start");
    await firstGate;
    events.push("first-end");
  });
  const second = enqueue(async () => {
    events.push("second");
    throw new Error("expected test failure");
  });
  const third = enqueue(async () => {
    events.push("third");
  });

  releaseFirst();
  await first;
  await assert.rejects(second, /expected test failure/);
  await third;

  assert.deepEqual(events, ["first-start", "first-end", "second", "third"]);
});