const OUTCOME_BUCKETS = ["1/6", "2/6", "3/6", "4/6", "5/6", "6/6", "X/6"];

function normalizeAlias(value) {
  return String(value).normalize("NFC").trim().replace(/^@/, "").toLocaleLowerCase();
}

function createUserStats() {
  return {
    totalScore: 0,
    totalPoints: 0,
    gamesPlayed: 0,
    wins: 0,
    outcomeCounts: Object.fromEntries(OUTCOME_BUCKETS.map((bucket) => [bucket, 0])),
    outcomeCountsComplete: true,
  };
}

function migrateUserStats(stats) {
  const totalScore = Number(stats.totalScore) || 0;
  const gamesPlayed = Number(stats.gamesPlayed) || 0;
  const wins = Number(stats.wins) || 0;
  const totalPoints = Number.isFinite(stats.totalPoints)
    ? stats.totalPoints
    : gamesPlayed * 7 - totalScore;
  const outcomeCountsComplete =
    stats.outcomeCountsComplete === true &&
    OUTCOME_BUCKETS.every((bucket) => Number.isInteger(stats.outcomeCounts?.[bucket]));

  return {
    totalScore,
    totalPoints,
    gamesPlayed,
    wins,
    outcomeCounts: outcomeCountsComplete
      ? Object.fromEntries(OUTCOME_BUCKETS.map((bucket) => [bucket, stats.outcomeCounts[bucket]]))
      : {
          ...Object.fromEntries(OUTCOME_BUCKETS.slice(0, 6).map((bucket) => [bucket, null])),
          "X/6": Math.max(0, gamesPlayed - wins),
        },
    outcomeCountsComplete,
  };
}

function addResultToUserStats(stats, result) {
  if (!OUTCOME_BUCKETS.includes(result.outcome)) return stats;

  Object.assign(stats, migrateUserStats(stats));
  stats.totalScore += result.attempts;
  stats.totalPoints += result.points;
  stats.gamesPlayed += 1;
  if (result.isWin) stats.wins += 1;
  if (stats.outcomeCounts[result.outcome] !== null) {
    stats.outcomeCounts[result.outcome] += 1;
  }
  stats.outcomeCountsComplete = OUTCOME_BUCKETS.every((bucket) =>
    Number.isInteger(stats.outcomeCounts[bucket]),
  );

  return stats;
}

function registerMentionAliases(aliases, message) {
  const mentionedUsers = message.mentions?.users;
  if (!mentionedUsers) return;

  for (const user of mentionedUsers.values()) {
    const member = message.mentions.members?.get(user.id);
    const names = [user.username, user.globalName, member?.displayName].filter(Boolean);

    for (const name of names) {
      const key = normalizeAlias(name);
      if (!key) continue;

      if (!Object.prototype.hasOwnProperty.call(aliases, key)) {
        aliases[key] = String(user.id);
      } else if (aliases[key] !== String(user.id)) {
        aliases[key] = null;
      }
    }
  }
}

function mergeUserStats(users, aliases = {}) {
  const merged = new Map();

    for (const [user, rawStats] of Object.entries(users)) {
      const stats = migrateUserStats(rawStats);
    const mention = user.match(/^<@!?(\d+)>$/);
    const aliasId = aliases[normalizeAlias(user)];
    const id = mention?.[1] || aliasId;
    const identity = id ? `id:${id}` : `name:${normalizeAlias(user)}`;
    const label = id ? `<@${id}>` : user;
    const current = merged.get(identity) || { ...createUserStats(), label };

    current.totalScore += stats.totalScore;
    current.totalPoints += stats.totalPoints;
    current.gamesPlayed += stats.gamesPlayed;
    current.wins += stats.wins;

    for (const bucket of OUTCOME_BUCKETS) {
      const currentCount = current.outcomeCounts[bucket];
      const incomingCount = stats.outcomeCounts[bucket];
      current.outcomeCounts[bucket] =
        currentCount === null || incomingCount === null
          ? null
          : currentCount + incomingCount;
    }
    current.outcomeCountsComplete = OUTCOME_BUCKETS.every((bucket) =>
      Number.isInteger(current.outcomeCounts[bucket]),
    );

    merged.set(identity, current);
  }

  return Object.fromEntries(
    Array.from(merged.values(), ({ label, ...stats }) => [label, stats]),
  );
}

function calculateRankings(users) {
  const entries = Object.entries(users)
    .map(([user, stats]) => ({ user, ...migrateUserStats(stats) }))
    .filter((entry) => entry.gamesPlayed > 0)
    .sort(
      (left, right) =>
        right.totalPoints - left.totalPoints || left.user.localeCompare(right.user),
    );

  let rank = 0;
  let previousPoints = null;

  return entries.map((entry, index) => {
    if (entry.totalPoints !== previousPoints) rank = index + 1;
    previousPoints = entry.totalPoints;
    return { ...entry, rank };
  });
}

function chunkLeaderboardRows(rows, maxLength = 900) {
  const chunks = [];
  let current = [];
  let currentLength = 0;

  for (const row of rows) {
    if (row.length > maxLength) {
      throw new RangeError("Una fila del ranking supera el máximo permitido.");
    }

    const separatorLength = current.length > 0 ? 1 : 0;
    if (current.length > 0 && currentLength + separatorLength + row.length > maxLength) {
      chunks.push(current.join("\n"));
      current = [];
      currentLength = 0;
    }

    if (current.length > 0) currentLength += 1;
    current.push(row);
    currentLength += row.length;
  }

  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

module.exports = {
  OUTCOME_BUCKETS,
  createUserStats,
  migrateUserStats,
  addResultToUserStats,
  registerMentionAliases,
  mergeUserStats,
  calculateRankings,
  chunkLeaderboardRows,
};