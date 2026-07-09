require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
} = require("discord.js");

const { createClient } = require("@supabase/supabase-js");

function logEvent(event, data = {}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...data,
    })
  );
}

function logError(event, error, data = {}) {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      message: error?.message,
      stack: error?.stack,
      ...data,
    })
  );
}

logEvent("bot_starting", {
  discordTokenExists: !!process.env.DISCORD_TOKEN,
  supabaseUrlExists: !!process.env.SUPABASE_URL,
  supabaseServiceKeyExists: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  nodeEnv: process.env.NODE_ENV || "unknown",
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const AGENCY_PREFIX = "Agency | ";
const TIME_ZONE = "America/New_York";
const AGENT_LEADERBOARD_LIMIT = 50;
const COMPANY_YTD_ADJUSTMENT_SOURCE = "company_ytd_adjustment";

const HIDDEN_AGENT_DISCORD_IDS = new Set([
  process.env.ALEX_GOWRO_DISCORD_ID,
].filter(Boolean));

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function safeErrorReply(interaction, message) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  } catch (err) {
    logError("failed_to_send_error_reply", err, {
      commandName: interaction?.commandName,
      userId: interaction?.user?.id,
    });
  }
}

function isCompanyYtdAdjustment(row) {
  return row?.source === COMPANY_YTD_ADJUSTMENT_SOURCE;
}

function getLeaderboardRows(data) {
  return (data || []).filter((row) => !isCompanyYtdAdjustment(row));
}

function isOwner(interaction) {
  return interaction.user.id === process.env.OWNER_DISCORD_ID;
}

function formatMoney(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function activeAgentLabel(count) {
  return count === 1 ? "Active Agent" : "Active Agents";
}

function getTodayIssueDate() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - date.getTime();
}

function zonedTimeToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(utcGuess, TIME_ZONE);

  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offset);
}

function getCurrentEasternDateParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function parseDateInput(dateInput) {
  if (!dateInput) return getCurrentEasternDateParts();

  const normalized = dateInput.trim().replaceAll("-", "/");
  const parts = normalized.split("/");

  if (parts.length !== 3) return null;

  const month = Number(parts[0]);
  const day = Number(parts[1]);
  const year = Number(parts[2]);

  if (!month || !day || !year) return null;

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) {
    return null;
  }

  return { year, month, day };
}

function getMonthRange() {
  const { year, month } = getCurrentEasternDateParts();

  const start = zonedTimeToUtc(year, month, 1);
  const end =
    month === 12
      ? zonedTimeToUtc(year + 1, 1, 1)
      : zonedTimeToUtc(year, month + 1, 1);

  const displayDate = zonedTimeToUtc(year, month, 1, 12);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    monthName: displayDate.toLocaleString("en-US", {
      timeZone: TIME_ZONE,
      month: "long",
    }),
    year,
  };
}

function getDayRange(dateInput) {
  const parsed = parseDateInput(dateInput);
  if (!parsed) return null;

  const { year, month, day } = parsed;

  const start = zonedTimeToUtc(year, month, day);
  const end = zonedTimeToUtc(year, month, day + 1);
  const displayDate = zonedTimeToUtc(year, month, day, 12);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    dayName: displayDate.toLocaleDateString("en-US", {
      timeZone: TIME_ZONE,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
}

function getAgentAgencyDisplayName(agencyName) {
  switch (agencyName) {
    case "Sezar Butrus (RFG)":
      return "RFG";
    case "Capital Financial Group":
      return "CFG";
    case "Priority Financial Group":
      return "PFG";
    case "Aziz Legacy":
      return "AL";
    case "Salvus Financial Group":
      return "SFG";
    case "Kassa Group":
      return "KG";
    case "SRS Financial":
      return "SRSF";
    case "Imperial Crest Financials":
      return "ICF";
    case "Ambition Prosperity Respect":
      return "APR/ICF";
    case "Stalex Financial":
      return "SF";
    default:
      return agencyName || "Unassigned";
  }
}

function getSaleAgencyDisplayName(agencyName) {
  switch (agencyName) {
    case "Sezar Butrus (RFG)":
      return "Royal Financial Group";
    case "Ambition Prosperity Respect":
      return "APR/ICF";
    default:
      return agencyName || "Unassigned Agency";
  }
}

function getAgencyLeaderboardDisplayName(agencyName) {
  switch (agencyName) {
    case "Sezar Butrus (RFG)":
      return "Royal Financial Group";
    case "Ambition Prosperity Respect":
      return "APR";
    default:
      return agencyName || "Unassigned Agency";
  }
}

function normalizeAgencyName(agencyName) {
  return String(agencyName || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getCanonicalAgencyName(agencyName) {
  const normalized = normalizeAgencyName(agencyName);

  switch (normalized) {
    case "imperial crest financials":
    case "imperial crest financial":
    case "icf":
      return "Imperial Crest Financials";

    case "ambition prosperity respect":
    case "apr":
    case "apr/icf":
    case "apr / icf":
      return "Ambition Prosperity Respect";

    case "sezar butrus (rfg)":
      return "Sezar Butrus (RFG)";

    default:
      return String(agencyName || "").trim() || "Unassigned Agency";
  }
}

function getAgencyLeaderboardRollupName(agencyName) {
  const canonicalAgencyName = getCanonicalAgencyName(agencyName);

  switch (canonicalAgencyName) {
    case "Imperial Crest Financials":
    case "Ambition Prosperity Respect":
      return "Imperial Crest Financials";

    default:
      return canonicalAgencyName;
  }
}

function getAgencyActiveAgentKey(row, originalAgencyName) {
  const agencyScope = normalizeAgencyName(originalAgencyName);

  if (row.discord_user_id) {
    return `${agencyScope}:discord:${row.discord_user_id}`;
  }

  if (row.agent_name) {
    return `${agencyScope}:agent:${String(row.agent_name)
      .trim()
      .toLowerCase()}`;
  }

  return null;
}

function getAgencyName(member) {
  const agencyRoles = member.roles.cache.filter((role) =>
    role.name.startsWith(AGENCY_PREFIX)
  );

  if (agencyRoles.size === 0) {
    return {
      ok: false,
      message: "You need an agency role like: Agency | RFG Financial",
    };
  }

  if (agencyRoles.size > 1) {
    return {
      ok: false,
      message: "You have multiple agency roles. Ask admin to keep only one.",
    };
  }

  return {
    ok: true,
    agencyName: agencyRoles.first().name.replace(AGENCY_PREFIX, "").trim(),
  };
}

function buildPolicyEmbed({
  carrier,
  monthlyPayment,
  annualPremium,
  agentName,
  agencyName,
}) {
  const displayAgencyName = getSaleAgencyDisplayName(agencyName);

  return new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle("💰 Policy Issued")
    .setDescription(
      [
        `# ${formatMoney(annualPremium)} AP`,
        "",
        `🏢 **${carrier}**`,
        `💵 **${formatMoney(monthlyPayment)}/mo**`,
        "",
        `👤 **${agentName}**`,
        `🏛️ **${displayAgencyName}**`,
      ].join("\n")
    )
    .setFooter({ text: `Submitted by ${agentName}` })
    .setTimestamp();
}

function buildAgentRows(data) {
  const map = new Map();

  for (const row of data || []) {
    const key = row.discord_user_id || row.agent_name || row.id;

    if (!map.has(key)) {
      map.set(key, {
        discordUserId: row.discord_user_id || null,
        agentName: row.agent_name || "Unknown Agent",
        agencyName: row.agency_name || "Unassigned Agency",
        policies: 0,
        monthly: 0,
        ap: 0,
      });
    }

    const current = map.get(key);
    current.policies += 1;
    current.monthly += Number(row.monthly_payment || 0);
    current.ap += Number(row.annual_premium || 0);
  }

  return [...map.values()].sort((a, b) => b.ap - a.ap);
}

function getVisibleAgentRows(rows) {
  return rows.filter((row) => !HIDDEN_AGENT_DISCORD_IDS.has(row.discordUserId));
}

function buildAgencyRows(data) {
  const originalAgencyMap = new Map();

  for (const row of data || []) {
    const originalAgencyName = getCanonicalAgencyName(row.agency_name);
    const rollupAgencyName = getAgencyLeaderboardRollupName(originalAgencyName);

    if (!originalAgencyMap.has(originalAgencyName)) {
      originalAgencyMap.set(originalAgencyName, {
        originalAgencyName,
        rollupAgencyName,
        policies: 0,
        ap: 0,
        activeAgents: new Set(),
      });
    }

    const current = originalAgencyMap.get(originalAgencyName);

    current.policies += 1;
    current.ap += Number(row.annual_premium || 0);

    const activeAgentKey = getAgencyActiveAgentKey(row, originalAgencyName);

    if (activeAgentKey) {
      current.activeAgents.add(activeAgentKey);
    }
  }

  const rollupMap = new Map();

  for (const originalAgency of originalAgencyMap.values()) {
    const agencyName = originalAgency.rollupAgencyName;

    if (!rollupMap.has(agencyName)) {
      rollupMap.set(agencyName, {
        agencyName,
        policies: 0,
        ap: 0,
        activeAgents: 0,
        isDisplayOnlyBreakout: false,
      });
    }

    const current = rollupMap.get(agencyName);

    // ICF still includes APR in the combined rollup.
    current.policies += originalAgency.policies;
    current.ap += originalAgency.ap;

    // Active agents are counted per original agency first, then added together.
    // Example: ICF 10 active agents + APR 6 active agents = 16.
    current.activeAgents += originalAgency.activeAgents.size;
  }

  const displayRows = [...rollupMap.values()];
  const aprOriginalAgency = originalAgencyMap.get("Ambition Prosperity Respect");

  // Show APR as a separate display-only row so APR can rank by itself,
  // while ICF still keeps the combined ICF + APR total.
  if (aprOriginalAgency && aprOriginalAgency.ap > 0) {
    displayRows.push({
      agencyName: "Ambition Prosperity Respect",
      policies: aprOriginalAgency.policies,
      ap: aprOriginalAgency.ap,
      activeAgents: aprOriginalAgency.activeAgents.size,
      isDisplayOnlyBreakout: true,
    });
  }

  return displayRows.sort((a, b) => b.ap - a.ap);
}

function getCountingAgencyRows(agencyRows) {
  return (agencyRows || []).filter((agency) => !agency.isDisplayOnlyBreakout);
}

async function fetchGuildMember(interaction) {
  logEvent("discord_member_fetch_started", {
    commandName: interaction.commandName,
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });

  const member = await withTimeout(
    interaction.guild.members.fetch(interaction.user.id),
    5000,
    "Discord member fetch"
  );

  logEvent("discord_member_fetch_completed", {
    commandName: interaction.commandName,
    userId: interaction.user.id,
    nickname: member.nickname || null,
  });

  return member;
}

async function runSupabaseQuery(query, label, metadata = {}) {
  logEvent("supabase_query_started", {
    label,
    ...metadata,
  });

  const result = await withTimeout(query, 8000, label);

  logEvent("supabase_query_completed", {
    label,
    rowCount: Array.isArray(result?.data) ? result.data.length : result?.data ? 1 : 0,
    hasError: !!result?.error,
    ...metadata,
  });

  return result;
}

function buildAgentLeaderboardText(visibleRows, limit = AGENT_LEADERBOARD_LIMIT) {
  return visibleRows
    .slice(0, limit)
    .map((r, i) => {
      const medals = ["🥇", "🥈", "🥉"];
      const displayAgencyName = getAgentAgencyDisplayName(r.agencyName);
      const amountText =
        i < 10 ? `**${formatMoney(r.ap)} AP**` : `${formatMoney(r.ap)} AP`;

      return `${medals[i] || `#${i + 1}`} ${r.agentName} · ${displayAgencyName} · ${amountText}`;
    })
    .join("\n");
}

function buildAgencyLeaderboardText(agencyRows) {
  return agencyRows
    .map((agency, i) => {
      const medals = ["🥇", "🥈", "🥉"];
      const displayAgencyName = getAgencyLeaderboardDisplayName(agency.agencyName);
      const breakoutText = agency.isDisplayOnlyBreakout ? " *(standalone)*" : "";
      const amountText =
        i < 3 ? `**${formatMoney(agency.ap)} AP**` : `${formatMoney(agency.ap)} AP`;

      return `${medals[i] || `#${i + 1}`} ${displayAgencyName}${breakoutText} · ${amountText} · ${
        agency.activeAgents
      } ${activeAgentLabel(agency.activeAgents)}`;
    })
    .join("\n");
}

client.once(Events.ClientReady, () => {
  logEvent("bot_online", {
    botTag: client.user.tag,
    botId: client.user.id,
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  logEvent("interaction_received", {
    type: interaction.type,
    commandName: interaction.commandName || null,
    userTag: interaction.user?.tag || null,
    userId: interaction.user?.id || null,
    guildId: interaction.guildId || null,
    channelId: interaction.channelId || null,
  });

  try {
    if (!interaction.isChatInputCommand()) {
      logEvent("interaction_ignored_non_command", {
        type: interaction.type,
      });
      return;
    }

    logEvent("command_started", {
      commandName: interaction.commandName,
      userTag: interaction.user.tag,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    });

    if (interaction.commandName === "sale") {
      await interaction.deferReply({ ephemeral: true });

      const carrier = interaction.options.getString("carrier")?.trim();
      const monthlyPayment = interaction.options.getNumber("monthly-premium");
      const issueDate = getTodayIssueDate();

      logEvent("sale_submission_started", {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        carrier,
        monthlyPayment,
        issueDate,
      });

      if (!carrier) {
        logEvent("sale_submission_rejected", {
          reason: "missing_carrier",
          userId: interaction.user.id,
        });

        await interaction.editReply("Please select a valid carrier.");
        return;
      }

      if (!monthlyPayment || monthlyPayment <= 0) {
        logEvent("sale_submission_rejected", {
          reason: "invalid_monthly_premium",
          userId: interaction.user.id,
          monthlyPayment,
        });

        await interaction.editReply("Enter a valid monthly premium.");
        return;
      }

      const member = await fetchGuildMember(interaction);
      const agency = getAgencyName(member);

      if (!agency.ok) {
        logEvent("sale_submission_rejected", {
          reason: "agency_role_issue",
          userId: interaction.user.id,
          message: agency.message,
        });

        await interaction.editReply(agency.message);
        return;
      }

      const agentName =
        member.nickname || interaction.user.globalName || interaction.user.username;

      const agencyName = agency.agencyName;
      const annualPremium = monthlyPayment * 12;

      logEvent("sale_submission_validated", {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        agentName,
        agencyName,
        carrier,
        monthlyPayment,
        annualPremium,
        issueDate,
      });

      const { error: agentError } = await runSupabaseQuery(
        supabase.from("discord_agents").upsert(
          {
            discord_user_id: interaction.user.id,
            agent_name: agentName,
            agency_name: agencyName,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "discord_user_id" }
        ),
        "Supabase discord_agents upsert",
        {
          commandName: "sale",
          userId: interaction.user.id,
          agentName,
          agencyName,
        }
      );

      if (agentError) throw agentError;

      const { data: policy, error } = await runSupabaseQuery(
        supabase
          .from("policy_submissions")
          .insert({
            discord_user_id: interaction.user.id,
            agent_name: agentName,
            agency_name: agencyName,
            carrier,
            monthly_payment: monthlyPayment,
            annual_premium: annualPremium,
            issue_date: issueDate,
            source: "discord",
          })
          .select()
          .single(),
        "Supabase policy insert",
        {
          commandName: "sale",
          userId: interaction.user.id,
          agentName,
          agencyName,
          annualPremium,
        }
      );

      if (error) throw error;

      logEvent("sale_saved_to_database", {
        policyId: policy.id,
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        agentName,
        agencyName,
        carrier,
        monthlyPayment,
        annualPremium,
        issueDate,
      });

      const embed = buildPolicyEmbed({
        carrier,
        monthlyPayment,
        annualPremium,
        agentName,
        agencyName,
      });

      logEvent("sale_discord_embed_sending", {
        policyId: policy.id,
        channelId: interaction.channelId,
      });

      const sentMessage = await withTimeout(
        interaction.channel.send({ embeds: [embed] }),
        5000,
        "Discord channel send"
      );

      logEvent("sale_discord_embed_sent", {
        policyId: policy.id,
        discordChannelId: sentMessage.channel.id,
        discordMessageId: sentMessage.id,
      });

      const { error: updateError } = await runSupabaseQuery(
        supabase
          .from("policy_submissions")
          .update({
            discord_channel_id: sentMessage.channel.id,
            discord_message_id: sentMessage.id,
          })
          .eq("id", policy.id),
        "Supabase policy message update",
        {
          commandName: "sale",
          policyId: policy.id,
        }
      );

      if (updateError) {
        logError("sale_message_id_update_failed", updateError, {
          policyId: policy.id,
        });
      }

      await interaction.editReply("Sale submitted successfully 💰");

      logEvent("sale_submission_completed", {
        policyId: policy.id,
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        agentName,
        agencyName,
        carrier,
        monthlyPayment,
        annualPremium,
      });

      return;
    }

    if (interaction.commandName === "leaderboard") {
      await interaction.deferReply();

      const { start, end, monthName, year } = getMonthRange();

      logEvent("leaderboard_requested", {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        monthName,
        year,
        start,
        end,
      });

      const member = await fetchGuildMember(interaction);
      const agency = getAgencyName(member);
      const owner = isOwner(interaction);

      if (!agency.ok && !owner) {
        logEvent("leaderboard_rejected", {
          reason: "agency_role_issue",
          userId: interaction.user.id,
          message: agency.message,
        });

        await interaction.editReply(agency.message);
        return;
      }

      const agencyName = agency.ok ? agency.agencyName : null;
      const generalChannelId = process.env.GENERAL_CHANNEL_ID;
      const isGeneralChannel =
        generalChannelId && interaction.channel.id === generalChannelId;

      let query = supabase
        .from("policy_submissions")
        .select("*")
        .eq("status", "active")
        .gte("submitted_at", start)
        .lt("submitted_at", end);

      if (!isGeneralChannel && !owner && agencyName) {
        query = query.eq("agency_name", agencyName);
      }

      const { data, error } = await runSupabaseQuery(
        query,
        "Supabase leaderboard query",
        {
          commandName: "leaderboard",
          userId: interaction.user.id,
          agencyName,
          isGeneralChannel,
          owner,
        }
      );

      if (error) throw error;

      const leaderboardRows = getLeaderboardRows(data);
      const allRows = buildAgentRows(leaderboardRows);
      const visibleRows = getVisibleAgentRows(allRows);

      logEvent("leaderboard_data_built", {
        userId: interaction.user.id,
        agencyName,
        rawRows: data?.length || 0,
        leaderboardRows: leaderboardRows.length,
        agentRows: allRows.length,
        visibleAgentRows: visibleRows.length,
      });

      if (allRows.length === 0) {
        await interaction.editReply(
          isGeneralChannel || owner
            ? `No policies submitted yet for ${monthName} ${year}.`
            : `No policies submitted yet for ${agencyName} in ${monthName} ${year}.`
        );

        logEvent("leaderboard_completed_empty", {
          userId: interaction.user.id,
          agencyName,
          monthName,
          year,
        });

        return;
      }

      if (visibleRows.length === 0) {
        await interaction.editReply(`No visible agent production yet for ${monthName} ${year}.`);

        logEvent("leaderboard_completed_no_visible_rows", {
          userId: interaction.user.id,
          agencyName,
          monthName,
          year,
        });

        return;
      }

      const agentLeaderboard = buildAgentLeaderboardText(visibleRows);
      const totalPolicies = allRows.reduce((s, r) => s + r.policies, 0);
      const totalAP = allRows.reduce((s, r) => s + r.ap, 0);

      const title =
        isGeneralChannel || owner
          ? `🏆 ${monthName} ${year} Agent Leaderboard`
          : `🏆 ${agencyName} ${monthName} ${year} Agent Leaderboard`;

      const embed = new EmbedBuilder()
        .setColor(isGeneralChannel || owner ? 0xfacc15 : 0x16a34a)
        .setTitle(title)
        .setDescription(
          `ㅤ
ㅤ
${agentLeaderboard}

📈 **${formatMoney(totalAP)}** Total AP
📄 **${totalPolicies}** Policies
👥 **${visibleRows.length}** Active Agents`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logEvent("leaderboard_completed", {
        userId: interaction.user.id,
        agencyName,
        monthName,
        year,
        totalPolicies,
        totalAP,
        visibleAgents: visibleRows.length,
      });

      return;
    }

    if (interaction.commandName === "agency-leaderboard") {
      await interaction.deferReply();

      const { start, end, monthName, year } = getMonthRange();

      logEvent("agency_leaderboard_requested", {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        monthName,
        year,
        start,
        end,
      });

      const { data, error } = await runSupabaseQuery(
        supabase
          .from("policy_submissions")
          .select("*")
          .eq("status", "active")
          .gte("submitted_at", start)
          .lt("submitted_at", end),
        "Supabase agency leaderboard query",
        {
          commandName: "agency-leaderboard",
          userId: interaction.user.id,
        }
      );

      if (error) throw error;

      const leaderboardRows = getLeaderboardRows(data);
      const agencyRows = buildAgencyRows(leaderboardRows);

      if (agencyRows.length === 0) {
        await interaction.editReply(`No agency production yet for ${monthName} ${year}.`);

        logEvent("agency_leaderboard_completed_empty", {
          userId: interaction.user.id,
          monthName,
          year,
        });

        return;
      }

      const agencyLeaderboard = buildAgencyLeaderboardText(agencyRows);
      const countingAgencyRows = getCountingAgencyRows(agencyRows);
      const totalPolicies = countingAgencyRows.reduce((s, r) => s + r.policies, 0);
      const totalAP = countingAgencyRows.reduce((s, r) => s + r.ap, 0);

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`🏢 ${monthName} ${year} Agency Leaderboard`)
        .setDescription(
          `ㅤ
ㅤ
${agencyLeaderboard}

📈 **${formatMoney(totalAP)}** Total AP
📄 **${totalPolicies}** Policies
🏢 **${countingAgencyRows.length}** Active Agencies`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logEvent("agency_leaderboard_completed", {
        userId: interaction.user.id,
        monthName,
        year,
        totalPolicies,
        totalAP,
        activeAgencies: countingAgencyRows.length,
      });

      return;
    }

    if (interaction.commandName === "daily-agency-leaderboard") {
      await interaction.deferReply();

      const dateInput = interaction.options.getString("date");
      const dayRange = getDayRange(dateInput);

      if (!dayRange) {
        await interaction.editReply("Enter the date like this: 06/01/2026 or 06-01-2026");
        return;
      }

      const { start, end, dayName } = dayRange;

      logEvent("daily_agency_leaderboard_requested", {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        dateInput,
        dayName,
        start,
        end,
      });

      const { data, error } = await runSupabaseQuery(
        supabase
          .from("policy_submissions")
          .select("*")
          .eq("status", "active")
          .gte("submitted_at", start)
          .lt("submitted_at", end),
        "Supabase daily agency leaderboard query",
        {
          commandName: "daily-agency-leaderboard",
          userId: interaction.user.id,
          dayName,
        }
      );

      if (error) throw error;

      const leaderboardRows = getLeaderboardRows(data);
      const agencyRows = buildAgencyRows(leaderboardRows);

      if (agencyRows.length === 0) {
        await interaction.editReply(`No agency production yet for ${dayName}.`);

        logEvent("daily_agency_leaderboard_completed_empty", {
          userId: interaction.user.id,
          dayName,
        });

        return;
      }

      const agencyLeaderboard = buildAgencyLeaderboardText(agencyRows);
      const countingAgencyRows = getCountingAgencyRows(agencyRows);
      const totalPolicies = countingAgencyRows.reduce((s, r) => s + r.policies, 0);
      const totalAP = countingAgencyRows.reduce((s, r) => s + r.ap, 0);

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("🏢 Daily Agency Leaderboard")
        .setDescription(
          `📅 ${dayName}

${agencyLeaderboard}

📈 **${formatMoney(totalAP)} AP** Total
📄 **${totalPolicies}** Policies
🏢 **${countingAgencyRows.length}** Active Agencies`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logEvent("daily_agency_leaderboard_completed", {
        userId: interaction.user.id,
        dayName,
        totalPolicies,
        totalAP,
        activeAgencies: countingAgencyRows.length,
      });

      return;
    }

    if (interaction.commandName === "daily-agent-leaderboard") {
      await interaction.deferReply();

      const dateInput = interaction.options.getString("date");
      const dayRange = getDayRange(dateInput);

      if (!dayRange) {
        await interaction.editReply("Enter the date like this: 06/01/2026 or 06-01-2026");
        return;
      }

      const { start, end, dayName } = dayRange;

      logEvent("daily_agent_leaderboard_requested", {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        dateInput,
        dayName,
        start,
        end,
      });

      const { data, error } = await runSupabaseQuery(
        supabase
          .from("policy_submissions")
          .select("*")
          .eq("status", "active")
          .gte("submitted_at", start)
          .lt("submitted_at", end),
        "Supabase daily agent leaderboard query",
        {
          commandName: "daily-agent-leaderboard",
          userId: interaction.user.id,
          dayName,
        }
      );

      if (error) throw error;

      const leaderboardRows = getLeaderboardRows(data);
      const allRows = buildAgentRows(leaderboardRows);
      const visibleRows = getVisibleAgentRows(allRows);

      if (allRows.length === 0) {
        await interaction.editReply(`No agent production yet for ${dayName}.`);

        logEvent("daily_agent_leaderboard_completed_empty", {
          userId: interaction.user.id,
          dayName,
        });

        return;
      }

      if (visibleRows.length === 0) {
        await interaction.editReply(`No visible agent production yet for ${dayName}.`);

        logEvent("daily_agent_leaderboard_completed_no_visible_rows", {
          userId: interaction.user.id,
          dayName,
        });

        return;
      }

      const agentLeaderboard = buildAgentLeaderboardText(visibleRows);
      const totalPolicies = allRows.reduce((s, r) => s + r.policies, 0);
      const totalAP = allRows.reduce((s, r) => s + r.ap, 0);

      const embed = new EmbedBuilder()
        .setColor(0xf97316)
        .setTitle("🏆 Daily Agent Leaderboard")
        .setDescription(
          `📅 ${dayName}

${agentLeaderboard}

📈 **${formatMoney(totalAP)} AP** Total
📄 **${totalPolicies}** Policies
👥 **${visibleRows.length}** Active Agents`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logEvent("daily_agent_leaderboard_completed", {
        userId: interaction.user.id,
        dayName,
        totalPolicies,
        totalAP,
        visibleAgents: visibleRows.length,
      });

      return;
    }

    if (interaction.commandName === "my-stats") {
      await interaction.deferReply({ ephemeral: true });

      const { start, end, monthName, year } = getMonthRange();

      logEvent("my_stats_requested", {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        monthName,
        year,
      });

      const { data, error } = await runSupabaseQuery(
        supabase
          .from("policy_submissions")
          .select("*")
          .eq("status", "active")
          .eq("discord_user_id", interaction.user.id)
          .gte("submitted_at", start)
          .lt("submitted_at", end),
        "Supabase my-stats query",
        {
          commandName: "my-stats",
          userId: interaction.user.id,
        }
      );

      if (error) throw error;

      const policies = getLeaderboardRows(data);
      const ap = policies.reduce((s, r) => s + Number(r.annual_premium || 0), 0);
      const monthly = policies.reduce((s, r) => s + Number(r.monthly_payment || 0), 0);

      const embed = new EmbedBuilder()
        .setColor(0x38bdf8)
        .setTitle(`📊 My ${monthName} ${year} Stats`)
        .addFields(
          { name: "📄 Policies", value: String(policies.length), inline: true },
          { name: "💵 Monthly Premium", value: formatMoney(monthly), inline: true },
          { name: "💰 AP", value: formatMoney(ap), inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logEvent("my_stats_completed", {
        userId: interaction.user.id,
        monthName,
        year,
        policies: policies.length,
        monthly,
        ap,
      });

      return;
    }

    logEvent("unknown_command_received", {
      commandName: interaction.commandName,
      userId: interaction.user.id,
    });

    await interaction.reply({
      content: "Unknown command. This command may need to be re-registered.",
      ephemeral: true,
    });
  } catch (error) {
    logError("command_error", error, {
      commandName: interaction.commandName,
      userTag: interaction.user?.tag,
      userId: interaction.user?.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      deferred: interaction.deferred,
      replied: interaction.replied,
    });

    await safeErrorReply(
      interaction,
      "Something took too long or failed. Try again in a few seconds."
    );
  }
});

process.on("unhandledRejection", (reason) => {
  logError("unhandled_rejection", reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("uncaughtException", (error) => {
  logError("uncaught_exception", error);
});

client.login(process.env.DISCORD_TOKEN);