function parseWordleMessage(content) {
  if (typeof content !== "string") return [];

  const results = [];
  const userPattern = /<@!?\d+>|@[\p{L}\p{N}_.-]+/gu;
  const scorePattern = /(?<![\d/])([1-6X])\s*\/\s*6\s*:/giu;

  for (const line of content.split(/\r?\n/)) {
    const scores = Array.from(line.matchAll(scorePattern));

    scores.forEach((scoreMatch, index) => {
      const start = scoreMatch.index + scoreMatch[0].length;
      const end = scores[index + 1]?.index ?? line.length;
      const scoreRaw = scoreMatch[1].toUpperCase();
      const attempts = scoreRaw === "X" ? 7 : Number(scoreRaw);
      const points = scoreRaw === "X" ? 0 : 7 - attempts;
      const usersText = line.slice(start, end);

      for (const userMatch of usersText.matchAll(userPattern)) {
        results.push({
          user: userMatch[0],
          score: attempts,
          attempts,
          outcome: `${scoreRaw}/6`,
          points,
          isWin: scoreRaw !== "X",
        });
      }
    });
  }

  return results;
}

module.exports = { parseWordleMessage };