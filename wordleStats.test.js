const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OUTCOME_BUCKETS,
  migrateUserStats,
  createUserStats,
  addResultToUserStats,
  registerMentionAliases,
  mergeUserStats,
  calculateRankings,
  chunkLeaderboardRows,
} = require("./wordleStats");

function legacyStats(totalScore, gamesPlayed, wins) {
  return {
    totalScore,
    totalPoints: gamesPlayed * 7 - totalScore,
    gamesPlayed,
    wins,
    outcomeCounts: {
      ...Object.fromEntries(OUTCOME_BUCKETS.slice(0, 6).map((bucket) => [bucket, null])),
      "X/6": gamesPlayed - wins,
    },
    outcomeCountsComplete: false,
  };
}

test("merges text usernames with Discord mention IDs", () => {
  const aliases = {};
  const users = new Map([
    ["123", { id: "123", username: "PlayerA", globalName: "PlayerA" }],
  ]);
  const members = new Map([
    ["123", { displayName: "PlayerA" }],
  ]);

  registerMentionAliases(aliases, { mentions: { users, members } });
  const merged = mergeUserStats(
    {
      "<@!123>": { totalScore: 30, gamesPlayed: 10, wins: 9 },
      "@PlayerA": { totalScore: 12, gamesPlayed: 4, wins: 4 },
      "@SomeoneElse": { totalScore: 5, gamesPlayed: 1, wins: 1 },
    },
    aliases,
  );

  assert.deepEqual(merged, {
    "<@123>": legacyStats(42, 14, 13),
    "@SomeoneElse": legacyStats(5, 1, 1),
  });
});

test("does not merge ambiguous aliases shared by different users", () => {
  const aliases = {};
  const users = new Map([
    ["123", { id: "123", username: "PlayerA", globalName: "PlayerA" }],
    ["456", { id: "456", username: "PlayerB", globalName: "PlayerA" }],
  ]);

  registerMentionAliases(aliases, { mentions: { users } });
  const merged = mergeUserStats(
    { "@PlayerA": { totalScore: 4, gamesPlayed: 1, wins: 1 } },
    aliases,
  );

  assert.deepEqual(merged, {
    "@PlayerA": legacyStats(4, 1, 1),
  });
});

test("merges configured text aliases under a Discord ID", () => {
  const merged = mergeUserStats(
    {
      "<@123456789012345678>": { totalScore: 21, gamesPlayed: 5, wins: 4 },
      "@PlayerV": { totalScore: 8, gamesPlayed: 2, wins: 2 },
      "@PlayerV-": { totalScore: 7, gamesPlayed: 2, wins: 1 },
    },
    {
      playerv: "123456789012345678",
      "playerv-": "123456789012345678",
    },
  );

  assert.deepEqual(merged, {
    "<@123456789012345678>": legacyStats(36, 9, 7),
  });
});

test("migrates points and losses without inventing legacy win buckets", () => {
  assert.deepEqual(migrateUserStats({ totalScore: 25, gamesPlayed: 5, wins: 4 }), {
    totalScore: 25,
    totalPoints: 10,
    gamesPlayed: 5,
    wins: 4,
    outcomeCounts: {
      "1/6": null,
      "2/6": null,
      "3/6": null,
      "4/6": null,
      "5/6": null,
      "6/6": null,
      "X/6": 1,
    },
    outcomeCountsComplete: false,
  });
});

test("accumulates all seven outcome buckets and their points", () => {
  const stats = createUserStats();
  const results = [1, 2, 3, 4, 5, 6].map((attempts) => ({
    attempts,
    outcome: `${attempts}/6`,
    points: 7 - attempts,
    isWin: true,
  }));
  results.push({ attempts: 7, outcome: "X/6", points: 0, isWin: false });

  for (const result of results) addResultToUserStats(stats, result);

  assert.equal(stats.totalPoints, 21);
  assert.equal(stats.totalScore, 28);
  assert.equal(stats.gamesPlayed, 7);
  assert.equal(stats.wins, 6);
  assert.equal(stats.outcomeCountsComplete, true);
  assert.deepEqual(stats.outcomeCounts, {
    "1/6": 1,
    "2/6": 1,
    "3/6": 1,
    "4/6": 1,
    "5/6": 1,
    "6/6": 1,
    "X/6": 1,
  });
});

test("ranks by total points and shares positions on ties", () => {
  const ranking = calculateRankings({
    "@OneGame": { totalScore: 1, totalPoints: 6, gamesPlayed: 1, wins: 1 },
    "@MoreGames": { totalScore: 2, totalPoints: 12, gamesPlayed: 2, wins: 2 },
    "@AlsoTwelve": { totalScore: 2, totalPoints: 12, gamesPlayed: 2, wins: 2 },
    "@Next": { totalScore: 5, totalPoints: 9, gamesPlayed: 1, wins: 1 },
  });

  assert.deepEqual(
    ranking.map(({ user, rank }) => [user, rank]),
    [
      ["@AlsoTwelve", 1],
      ["@MoreGames", 1],
      ["@Next", 3],
      ["@OneGame", 4],
    ],
  );
});

test("chunks leaderboard rows within the field-size limit", () => {
  const rows = ["a".repeat(500), "b".repeat(500), "c"];
  const chunks = chunkLeaderboardRows(rows, 900);

  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 900));
  assert.deepEqual(chunks.flatMap((chunk) => chunk.split("\n")), rows);
});