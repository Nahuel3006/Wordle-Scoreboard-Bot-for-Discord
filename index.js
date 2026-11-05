require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const { parseWordleMessage } = require("./wordleParser");
const {
  resolveProcessingBoundary,
  walkMessagesBackwards,
  createSerialQueue,
} = require("./wordleHistory");
const {
  createUserStats,
  addResultToUserStats,
  registerMentionAliases,
  mergeUserStats,
  calculateRankings,
  chunkLeaderboardRows,
} = require("./wordleStats");

const DATA_FILE = path.join(__dirname, "wordle_stats.json");

// Cargar o inicializar las estadísticas y opciones guardadas localmente.
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      autoTrackChannelId: null,
      autoOutputChannelId: null,
      lastProcessedId: null,
      userAliases: {},
      users: {},
    };
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  data.userAliases ||= {};
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const enqueueProcessing = createSerialQueue();

async function processMessages(
  sourceChannel,
  targetChannel,
  recalculate = false,
  startFromId = null,
) {
  let db = loadData();

  if (recalculate) {
    db.users = {};
    db.lastProcessedId = null;
    console.log("♻️ [RECALCULATE] Statistics cleared.");
  }

  const { checkpointId, includeCheckpoint } = resolveProcessingBoundary({
    recalculate,
    startFromId,
    savedCheckpointId: db.lastProcessedId,
  });
  let totalProcessedMessages = 0;
  let totalParsedResults = 0;

  console.log(
    `🔍 [START] Reading channel: #${sourceChannel.name} | Starting from ID: ${checkpointId || "oldest available"}`,
  );

  const traversal = await walkMessagesBackwards(
    sourceChannel,
    checkpointId,
    async (page, batch) => {
      for (const message of page) {
        registerMentionAliases(db.userAliases, message);
      }

      const candidates = page.filter((message) => {
        const content = message.content || "";
        const username = message.author?.username || "";
        return /\bresults\b/i.test(content) || /wordle/i.test(username);
      });
      let parsedMessageCount = 0;
      let parsedResultCount = 0;

      for (const message of candidates) {
        const parsed = parseWordleMessage(message.content);
        if (parsed.length > 0) parsedMessageCount += 1;

        for (const item of parsed) {
          if (!db.users[item.user]) db.users[item.user] = createUserStats();
          addResultToUserStats(db.users[item.user], item);
          parsedResultCount += 1;
        }
      }

      totalProcessedMessages += parsedMessageCount;
      totalParsedResults += parsedResultCount;
      console.log(
        `[BATCH #${batch.batchCount}] fetched=${batch.fetchedCount}, candidates=${candidates.length}, parsed_messages=${parsedMessageCount}, results=${parsedResultCount}, IDs=${batch.oldestId}-${batch.newestId}`,
      );
    },
    includeCheckpoint,
  );

  if (traversal.newestMessageId) {
    db.lastProcessedId = traversal.newestMessageId;
  }
  db.users = mergeUserStats(db.users, db.userAliases);
  saveData(db);

  console.log(
    `✅ [PROCESS COMPLETE] Parsed messages: ${totalProcessedMessages}; individual results: ${totalParsedResults}; messages fetched: ${traversal.totalFetched}.`,
  );

  // Construir la publicación de resultados y la clasificación.
  const embed = new EmbedBuilder()
    .setTitle("🏆 Wordle Scoreboard - Results")
    .setColor(0x538d4e)
    .setDescription("*Statistics updated successfully.*")
    .setTimestamp();

  const sortedUsers = calculateRankings(db.users);

  if (sortedUsers.length === 0) {
    embed.addFields({
      name: "Status",
      value: "No valid results were found.",
    });
  } else {
    const rows = sortedUsers.map((user) => {
      const outcomes = user.outcomeCountsComplete
        ? ["1/6", "2/6", "3/6", "4/6", "5/6", "6/6", "X/6"]
          .map((bucket) => `${user.outcomeCounts[bucket]} in ${bucket}`)
            .join(", ")
        : ["1/6", "2/6", "3/6", "4/6", "5/6", "6/6", "X/6"]
          .map((bucket) => `${user.outcomeCounts[bucket] ?? "?"} in ${bucket}`)
            .join(", ");

      return `**#${user.rank}** ${user.user} - results: ${outcomes}; points: **${user.totalPoints}**`;
    });
    const rankingChunks = chunkLeaderboardRows(rows);

    const rankingEmbeds = rankingChunks.map((chunk, index) => {
      const pageTitle = rankingChunks.length > 1
        ? `🏆 Wordle Scoreboard Bot for Discord (${index + 1}/${rankingChunks.length})`
        : "🏆 Wordle Scoreboard Bot for Discord";
      return new EmbedBuilder()
        .setTitle(pageTitle)
        .setColor(0x538d4e)
        .setDescription("Ranked by total points. Tied scores share the same position.")
        .addFields({ name: "Ranking", value: chunk });
    });

    for (let index = 0; index < rankingEmbeds.length; index += 4) {
      await targetChannel.send({ embeds: rankingEmbeds.slice(index, index + 4) });
    }
    return;
  }

  await targetChannel.send({ embeds: [embed] });
}

// Crear el cliente con acceso a los mensajes de los servidores.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Registrar los comandos disponibles y sus opciones.
const commands = [
  new SlashCommandBuilder()
    .setName("obtenerresultados")
    .setDescription("Calculate and publish Wordle statistics")
    .addChannelOption((opt) =>
      opt
        .setName("canal")
        .setDescription("Source channel whose messages should be processed")
        .setRequired(true),
    )
    .addChannelOption((opt) =>
      opt
        .setName("canal2")
        .setDescription("Channel for the leaderboard (defaults to the source channel)")
        .setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("recalcular")
        .setDescription("Rebuild statistics from scratch (default: false)")
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName("desde_id")
        .setDescription(
          "First message ID to include when recalculating; ignored otherwise",
        )
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("rastrear")
    .setDescription(
      "Configure automatic tracking for new Wordle results",
    )
    .addChannelOption((opt) =>
      opt
        .setName("canal")
        .setDescription("Source channel where the Wordle bot posts results")
        .setRequired(true),
    )
    .addChannelOption((opt) =>
      opt
        .setName("canal2")
        .setDescription("Channel where the leaderboard will be posted")
        .setRequired(true),
    ),
];

client.once("clientReady", async () => {
  console.log(`Bot is ready as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log("Slash commands registered successfully.");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
});

// Atender las solicitudes de los comandos slash.
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === "obtenerresultados") {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const canalOrigen = options.getChannel("canal");
    const canalDestino = options.getChannel("canal2") || canalOrigen;
    const recalcular = options.getBoolean("recalcular") || false;
    const desdeId = options.getString("desde_id") || null;

    try {
      await enqueueProcessing(() =>
        processMessages(canalOrigen, canalDestino, recalcular, desdeId),
      );
      await interaction.editReply(
        `✅ Results processed and posted in ${canalDestino}.`,
      );
    } catch (err) {
      console.error(err);
      await interaction.editReply(
        `❌ An error occurred while processing results: ${err.message}`,
      );
    }
  }

  if (commandName === "rastrear") {
    const canalOrigen = options.getChannel("canal");
    const canalDestino = options.getChannel("canal2");

    await enqueueProcessing(() => {
      const db = loadData();
      db.autoTrackChannelId = canalOrigen.id;
      db.autoOutputChannelId = canalDestino.id;
      saveData(db);
    });

    await interaction.reply({
      content: `📌 Automatic tracking enabled. Listening in ${canalOrigen} and posting results in ${canalDestino}.`,
      flags: [MessageFlags.Ephemeral],
    });
  }
});

// Actualizar las estadísticas cuando llega un resultado al canal vigilado.
client.on("messageCreate", async (message) => {
  const db = loadData();

  if (!db.autoTrackChannelId || message.channel.id !== db.autoTrackChannelId)
    return;

  if (
    message.content.includes("results") ||
    message.author.username.includes("Wordle")
  ) {
    try {
      const targetChannel = await client.channels.fetch(db.autoOutputChannelId);
      if (targetChannel) {
        console.log("⚡ [LIVE] New Wordle result message detected.");
        await enqueueProcessing(() =>
          processMessages(message.channel, targetChannel, false),
        );
      }
    } catch (err) {
      console.error("Automatic Wordle tracking failed:", err);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
