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
const { walkMessagesBackwards, createSerialQueue } = require("./wordleHistory");
const {
  createUserStats,
  addResultToUserStats,
  registerMentionAliases,
  mergeUserStats,
  calculateRankings,
  chunkLeaderboardRows,
} = require("./wordleStats");

const DATA_FILE = path.join(__dirname, "wordle_stats.json");

// Cargar o inicializar la base de datos local
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
    console.log("♻️ [RECALCULAR] Base de datos limpiada.");
  }

  const checkpointId = startFromId || db.lastProcessedId;
  let totalProcessedMessages = 0;
  let totalParsedResults = 0;

  console.log(
    `🔍 [INICIO] Leyendo canal: #${sourceChannel.name} | Desde ID: ${checkpointId || "Inicio"}`,
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
        `[LOTE #${batch.batchCount}] descargados=${batch.fetchedCount}, candidatos=${candidates.length}, mensajes_parseados=${parsedMessageCount}, resultados=${parsedResultCount}, IDs=${batch.oldestId}-${batch.newestId}`,
      );
    },
    Boolean(startFromId || recalculate),
  );

  if (traversal.newestMessageId) {
    db.lastProcessedId = traversal.newestMessageId;
  }
  db.users = mergeUserStats(db.users, db.userAliases);
  saveData(db);

  console.log(
    `✅ [PROCESO FINALIZADO] Mensajes parseados: ${totalProcessedMessages}; resultados individuales: ${totalParsedResults}; mensajes descargados: ${traversal.totalFetched}.`,
  );

  // Generar Embed con la tabla de posiciones y etiquetas reales
  const embed = new EmbedBuilder()
    .setTitle("🏆 Tabla de Posiciones - Wordle Group")
    .setColor(0x538d4e)
    .setDescription(`*Estadísticas actualizadas correctamente.*`)
    .setTimestamp();

  const sortedUsers = calculateRankings(db.users);

  if (sortedUsers.length === 0) {
    embed.addFields({
      name: "Estado",
      value: "No se encontraron resultados válidos.",
    });
  } else {
    const rows = sortedUsers.map((user) => {
      const outcomes = user.outcomeCountsComplete
        ? ["1/6", "2/6", "3/6", "4/6", "5/6", "6/6", "X/6"]
            .map((bucket) => `${user.outcomeCounts[bucket]} en ${bucket}`)
            .join(", ")
        : ["1/6", "2/6", "3/6", "4/6", "5/6", "6/6", "X/6"]
            .map((bucket) => `${user.outcomeCounts[bucket] ?? "?"} en ${bucket}`)
            .join(", ");

      return `**#${user.rank}** ${user.user} - resultados: ${outcomes}; puntos: **${user.totalPoints}**`;
    });
    const rankingChunks = chunkLeaderboardRows(rows);

    const rankingEmbeds = rankingChunks.map((chunk, index) => {
      const pageTitle = rankingChunks.length > 1
        ? `🏆 Tabla de Puntos - Wordle Group (${index + 1}/${rankingChunks.length})`
        : "🏆 Tabla de Puntos - Wordle Group";
      return new EmbedBuilder()
        .setTitle(pageTitle)
        .setColor(0x538d4e)
        .setDescription("Ordenado por puntos acumulados. Los empates comparten puesto.")
        .addFields({ name: "Ranking", value: chunk });
    });

    for (let index = 0; index < rankingEmbeds.length; index += 4) {
      await targetChannel.send({ embeds: rankingEmbeds.slice(index, index + 4) });
    }
    return;
  }

  await targetChannel.send({ embeds: [embed] });
}

// Configuración del Cliente Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Definición de comandos Slash con el parámetro desde_id
const commands = [
  new SlashCommandBuilder()
    .setName("obtenerresultados")
    .setDescription("Calcula y publica las estadísticas de Wordle")
    .addChannelOption((opt) =>
      opt
        .setName("canal")
        .setDescription("Canal de origen de los mensajes")
        .setRequired(true),
    )
    .addChannelOption((opt) =>
      opt
        .setName("canal2")
        .setDescription("Canal donde publicar (por defecto el de origen)")
        .setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("recalcular")
        .setDescription("Recalcular todo desde cero (default: false)")
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName("desde_id")
        .setDescription(
          "ID del primer mensaje que se incluirá (clic derecho -> Copiar ID)",
        )
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("rastrear")
    .setDescription(
      "Configura el rastreo automático para cuando llegue un nuevo mensaje de Wordle",
    )
    .addChannelOption((opt) =>
      opt
        .setName("canal")
        .setDescription("Canal origen donde publica el bot de Wordle")
        .setRequired(true),
    )
    .addChannelOption((opt) =>
      opt
        .setName("canal2")
        .setDescription("Canal donde volcar los resultados")
        .setRequired(true),
    ),
];

client.once("clientReady", async () => {
  console.log(`Bot listo como ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log("Comandos Slash registrados correctamente.");
  } catch (err) {
    console.error("Error al registrar comandos:", err);
  }
});

// Manejador de Comandos Slash
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
        `✅ Resultados procesados y volcados en ${canalDestino}.`,
      );
    } catch (err) {
      console.error(err);
      await interaction.editReply(
        `❌ Ocurrió un error al procesar: ${err.message}`,
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
      content: `📌 Rastreo automático activado. Escuchando en ${canalOrigen} y volcando en ${canalDestino}.`,
      flags: [MessageFlags.Ephemeral],
    });
  }
});

// Listener para el rastreo automático en tiempo real
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
        console.log(`⚡ [TIEMPO REAL] Nuevo mensaje de Wordle detectado.`);
        await enqueueProcessing(() =>
          processMessages(message.channel, targetChannel, false),
        );
      }
    } catch (err) {
      console.error("Error en el rastreo automático de Wordle:", err);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
