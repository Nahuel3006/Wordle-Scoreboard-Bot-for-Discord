const PAGE_SIZE = 100;

function compareSnowflakes(left, right) {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function resolveProcessingBoundary({ recalculate, startFromId, savedCheckpointId }) {
  if (recalculate) {
    return {
      checkpointId: startFromId || null,
      includeCheckpoint: Boolean(startFromId),
    };
  }

  return {
    checkpointId: savedCheckpointId || null,
    includeCheckpoint: false,
  };
}

async function walkMessagesBackwards(
  sourceChannel,
  checkpointId,
  visitPage,
  includeCheckpoint = false,
) {
  let beforeId = null;
  let newestMessageId = null;
  let batchCount = 0;
  let totalFetched = 0;

  while (true) {
    const options = { limit: PAGE_SIZE };
    if (beforeId) options.before = beforeId;

    const fetched = await sourceChannel.messages.fetch(options);
    const page = Array.from(fetched.values()).sort((left, right) =>
      compareSnowflakes(left.id, right.id),
    );

    if (page.length === 0) break;

    batchCount += 1;
    totalFetched += page.length;
    const oldestId = page[0].id;
    const newestId = page[page.length - 1].id;
    if (newestMessageId === null) newestMessageId = newestId;

    const eligible = checkpointId
      ? page.filter((message) => {
          const comparison = compareSnowflakes(message.id, checkpointId);
          return includeCheckpoint ? comparison >= 0 : comparison > 0;
        })
      : page;

    await visitPage(eligible, {
      batchCount,
      fetchedCount: page.length,
      oldestId,
      newestId,
    });

    if (checkpointId && compareSnowflakes(oldestId, checkpointId) <= 0) break;
    if (page.length < PAGE_SIZE) break;
    if (beforeId && compareSnowflakes(oldestId, beforeId) >= 0) {
      throw new Error("La paginación no avanzó hacia mensajes más antiguos.");
    }

    beforeId = oldestId;
  }

  return { newestMessageId, batchCount, totalFetched };
}

function createSerialQueue() {
  let tail = Promise.resolve();

  return function enqueue(task) {
    const result = tail.then(task, task);
    tail = result.catch(() => {});
    return result;
  };
}

module.exports = {
  resolveProcessingBoundary,
  walkMessagesBackwards,
  createSerialQueue,
};