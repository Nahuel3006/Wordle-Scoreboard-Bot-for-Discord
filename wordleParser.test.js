const test = require("node:test");
const assert = require("node:assert/strict");
const { parseWordleMessage } = require("./wordleParser");

test("parses an emoji-prefixed result with Unicode usernames", () => {
  const parsed = parseWordleMessage("👑 4/6: @PlayerA @PlayerB");

  assert.deepEqual(parsed, [
    { user: "@PlayerA", score: 4, attempts: 4, outcome: "4/6", points: 3, isWin: true },
    { user: "@PlayerB", score: 4, attempts: 4, outcome: "4/6", points: 3, isWin: true },
  ]);
});

test("parses multiple results on one line", () => {
  const parsed = parseWordleMessage(
    "Here are yesterday's results: 👑 4/6: @PlayerA 5/6: @PlayerB 6/6: @PlayerC",
  );

  assert.deepEqual(parsed, [
    { user: "@PlayerA", score: 4, attempts: 4, outcome: "4/6", points: 3, isWin: true },
    { user: "@PlayerB", score: 5, attempts: 5, outcome: "5/6", points: 2, isWin: true },
    { user: "@PlayerC", score: 6, attempts: 6, outcome: "6/6", points: 1, isWin: true },
  ]);
});

test("maps every result to points and parses losses with Discord mention IDs", () => {
  const parsed = [1, 2, 3, 4, 5, 6].map((score) =>
    parseWordleMessage(`${score}/6: @User`)[0].points,
  );

  assert.deepEqual(parsed, [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(parseWordleMessage("X/6: <@!123456789>"), [
    {
      user: "<@!123456789>",
      score: 7,
      attempts: 7,
      outcome: "X/6",
      points: 0,
      isWin: false,
    },
  ]);
});

test("ignores invalid scores and unrelated text", () => {
  assert.deepEqual(parseWordleMessage("7/6: @PlayerA |/6: @PlayerB"), []);
  assert.deepEqual(parseWordleMessage(null), []);
});