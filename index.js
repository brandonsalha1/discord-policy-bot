require('dotenv').config()

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
} = require('discord.js')

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
})

const AGENCY_PREFIX = 'Agency | '
const TIME_ZONE = 'America/New_York'

const HIDDEN_AGENT_DISCORD_IDS = new Set([
  process.env.ALEX_GOWRO_DISCORD_ID,
].filter(Boolean))

const AGENT_LEADERBOARD_LIMIT = 50
const COMPANY_YTD_ADJUSTMENT_SOURCE = 'company_ytd_adjustment'

function isCompanyYtdAdjustment(row) {
  return row?.source === COMPANY_YTD_ADJUSTMENT_SOURCE
}

function getLeaderboardRows(data) {
  return (data || []).filter((row) => !isCompanyYtdAdjustment(row))
}

function isOwner(interaction) {
  return interaction.user.id === process.env.OWNER_DISCORD_ID
}

function formatMoney(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0))
}

function activeAgentLabel(count) {
  return count === 1 ? 'Active Agent' : 'Active Agents'
}

function getTodayIssueDate() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(new Date())
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const values = {}

  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value
  }

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  )

  return asUtc - date.getTime()
}

function zonedTimeToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const offset = getTimeZoneOffsetMs(utcGuess, TIME_ZONE)

  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - offset
  )
}

function getCurrentEasternDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const values = {}

  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  }
}

function parseDateInput(dateInput) {
  if (!dateInput) return getCurrentEasternDateParts()

  const normalized = dateInput.trim().replaceAll('-', '/')
  const parts = normalized.split('/')

  if (parts.length !== 3) return null

  const month = Number(parts[0])
  const day = Number(parts[1])
  const year = Number(parts[2])

  if (!month || !day || !year) return null

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) {
    return null
  }

  return { year, month, day }
}

function getMonthRange() {
  const { year, month } = getCurrentEasternDateParts()

  const start = zonedTimeToUtc(year, month, 1, 0, 0, 0)
  const end =
    month === 12
      ? zonedTimeToUtc(year + 1, 1, 1, 0, 0, 0)
      : zonedTimeToUtc(year, month + 1, 1, 0, 0, 0)

  const displayDate = zonedTimeToUtc(year, month, 1, 12, 0, 0)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    monthName: displayDate.toLocaleString('en-US', {
      timeZone: TIME_ZONE,
      month: 'long',
    }),
    year,
  }
}

function getDayRange(dateInput) {
  const parsed = parseDateInput(dateInput)

  if (!parsed) return null

  const { year, month, day } = parsed

  const start = zonedTimeToUtc(year, month, day, 0, 0, 0)
  const end = zonedTimeToUtc(year, month, day + 1, 0, 0, 0)
  const displayDate = zonedTimeToUtc(year, month, day, 12, 0, 0)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    dayName: displayDate.toLocaleDateString('en-US', {
      timeZone: TIME_ZONE,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
  }
}

function getAgentAgencyDisplayName(agencyName) {
  switch (agencyName) {
    case 'Sezar Butrus (RFG)':
      return 'RFG'
    case 'Capital Financial Group':
      return 'CFG'
    case 'Priority Financial Group':
      return 'PFG'
    case 'Aziz Legacy':
      return 'AL'
    case 'Salvus Financial Group':
      return 'SFG'
    case 'Kassa Group':
      return 'KG'
    case 'SRS Financial':
      return 'SRSF'
    case 'Imperial Crest Financials':
      return 'ICF'
    case 'Stalex Financial':
      return 'SF'
    default:
      return agencyName || 'Unassigned'
  }
}

function getSaleAgencyDisplayName(agencyName) {
  switch (agencyName) {
    case 'Sezar Butrus (RFG)':
      return 'Royal Financial Group'
    default:
      return agencyName || 'Unassigned Agency'
  }
}

function getAgencyLeaderboardDisplayName(agencyName) {
  switch (agencyName) {
    case 'Sezar Butrus (RFG)':
      return 'Royal Financial Group'
    default:
      return agencyName || 'Unassigned Agency'
  }
}

function getAgencyName(member) {
  const agencyRoles = member.roles.cache.filter((role) =>
    role.name.startsWith(AGENCY_PREFIX)
  )

  if (agencyRoles.size === 0) {
    return {
      ok: false,
      message: 'You need an agency role like: Agency | RFG Financial',
    }
  }

  if (agencyRoles.size > 1) {
    return {
      ok: false,
      message: 'You have multiple agency roles. Ask admin to keep only one.',
    }
  }

  return {
    ok: true,
    agencyName: agencyRoles.first().name.replace(AGENCY_PREFIX, '').trim(),
  }
}

function buildPolicyEmbed({
  carrier,
  monthlyPayment,
  annualPremium,
  agentName,
  agencyName,
}) {
  const displayAgencyName = getSaleAgencyDisplayName(agencyName)

  return new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle('💰 Policy Issued')
    .setDescription(
      [
        `# ${formatMoney(annualPremium)} AP`,
        '',
        `🏢 **${carrier}**`,
        `💵 **${formatMoney(monthlyPayment)}/mo**`,
        '',
        `👤 **${agentName}**`,
        `🏛️ **${displayAgencyName}**`,
      ].join('\n')
    )
    .setFooter({
      text: `Submitted by ${agentName}`,
    })
    .setTimestamp()
}

function buildAgentRows(data) {
  const map = new Map()

  for (const row of data || []) {
    const key = row.discord_user_id || row.agent_name || row.id

    if (!map.has(key)) {
      map.set(key, {
        discordUserId: row.discord_user_id || null,
        agentName: row.agent_name || 'Unknown Agent',
        agencyName: row.agency_name || 'Unassigned Agency',
        policies: 0,
        monthly: 0,
        ap: 0,
      })
    }

    const current = map.get(key)
    current.policies += 1
    current.monthly += Number(row.monthly_payment || 0)
    current.ap += Number(row.annual_premium || 0)
  }

  return [...map.values()].sort((a, b) => b.ap - a.ap)
}

function getVisibleAgentRows(rows) {
  return rows.filter((row) => !HIDDEN_AGENT_DISCORD_IDS.has(row.discordUserId))
}

function buildAgencyRows(data) {
  const map = new Map()

  for (const row of data || []) {
    const agencyName = row.agency_name || 'Unassigned Agency'

    if (!map.has(agencyName)) {
      map.set(agencyName, {
        agencyName,
        policies: 0,
        ap: 0,
        activeAgents: new Set(),
      })
    }

    const current = map.get(agencyName)

    current.policies += 1
    current.ap += Number(row.annual_premium || 0)

    if (row.discord_user_id) {
      current.activeAgents.add(row.discord_user_id)
    }
  }

  return [...map.values()]
    .map((agency) => ({
      agencyName: agency.agencyName,
      policies: agency.policies,
      ap: agency.ap,
      activeAgents: agency.activeAgents.size,
    }))
    .sort((a, b) => b.ap - a.ap)
}

client.once(Events.ClientReady, () => {
  console.log(`Bot is online as ${client.user.tag}`)
})

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return

    if (interaction.commandName === 'sale') {
      await interaction.deferReply({ ephemeral: true })

      const carrier = interaction.options.getString('carrier').trim()
      const monthlyPayment = interaction.options.getNumber('monthly-premium')
      const issueDate = getTodayIssueDate()

      if (!monthlyPayment || monthlyPayment <= 0) {
        await interaction.editReply('Enter a valid monthly premium.')
        return
      }

      const member = await interaction.guild.members.fetch(interaction.user.id)
      const agency = getAgencyName(member)

      if (!agency.ok) {
        await interaction.editReply(agency.message)
        return
      }

      const agentName =
        member.nickname || interaction.user.globalName || interaction.user.username

      const agencyName = agency.agencyName
      const annualPremium = monthlyPayment * 12

      await supabase.from('discord_agents').upsert(
        {
          discord_user_id: interaction.user.id,
          agent_name: agentName,
          agency_name: agencyName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'discord_user_id' }
      )

      const { data: policy, error } = await supabase
        .from('policy_submissions')
        .insert({
          discord_user_id: interaction.user.id,
          agent_name: agentName,
          agency_name: agencyName,
          carrier,
          monthly_payment: monthlyPayment,
          annual_premium: annualPremium,
          issue_date: issueDate,
          source: 'discord',
        })
        .select()
        .single()

      if (error) throw error

      const embed = buildPolicyEmbed({
        carrier,
        monthlyPayment,
        annualPremium,
        agentName,
        agencyName,
      })

      const sentMessage = await interaction.channel.send({ embeds: [embed] })

      await supabase
        .from('policy_submissions')
        .update({
          discord_channel_id: sentMessage.channel.id,
          discord_message_id: sentMessage.id,
        })
        .eq('id', policy.id)

      await interaction.editReply('Sale submitted successfully 💰')
      return
    }

    if (interaction.commandName === 'leaderboard') {
      await interaction.deferReply()

      const { start, end, monthName, year } = getMonthRange()

      const member = await interaction.guild.members.fetch(interaction.user.id)
      const agency = getAgencyName(member)
      const owner = isOwner(interaction)

      if (!agency.ok && !owner) {
        await interaction.editReply(agency.message)
        return
      }

      const agencyName = agency.ok ? agency.agencyName : null
      const generalChannelId = process.env.GENERAL_CHANNEL_ID
      const isGeneralChannel =
        generalChannelId && interaction.channel.id === generalChannelId

      let query = supabase
        .from('policy_submissions')
        .select('*')
        .eq('status', 'active')
        .gte('submitted_at', start)
        .lt('submitted_at', end)

      if (!isGeneralChannel && !owner && agencyName) {
        query = query.eq('agency_name', agencyName)
      }

      const { data, error } = await query

      if (error) throw error

      const leaderboardRows = getLeaderboardRows(data)
      const allRows = buildAgentRows(leaderboardRows)
      const visibleRows = getVisibleAgentRows(allRows)

      if (allRows.length === 0) {
        const emptyMessage =
          isGeneralChannel || owner
            ? `No policies submitted yet for ${monthName} ${year}.`
            : `No policies submitted yet for ${agencyName} in ${monthName} ${year}.`

        await interaction.editReply(emptyMessage)
        return
      }

      if (visibleRows.length === 0) {
        await interaction.editReply(
          `No visible agent production yet for ${monthName} ${year}.`
        )
        return
      }

      const topTen = visibleRows
        .slice(0, 10)
        .map((r, i) => {
          const medals = ['🥇', '🥈', '🥉']
          const displayAgencyName = getAgentAgencyDisplayName(r.agencyName)

          return `${medals[i] || `#${i + 1}`} ${r.agentName} · ${displayAgencyName} · **${formatMoney(
            r.ap
          )} AP**`
        })
        .join('\n')

  const rest =
  visibleRows
    .slice(10, AGENT_LEADERBOARD_LIMIT)
          .map((r, i) => {
            const displayAgencyName = getAgentAgencyDisplayName(r.agencyName)

            return `#${i + 11} ${r.agentName} · ${displayAgencyName} · ${formatMoney(
              r.ap
            )} AP`
          })
          .join('\n') || ''

      const agentLeaderboard = `${topTen}${rest ? `\n${rest}` : ''}`

      const totalPolicies = allRows.reduce((s, r) => s + r.policies, 0)
      const totalAP = allRows.reduce((s, r) => s + r.ap, 0)

      const title =
        isGeneralChannel || owner
          ? `🏆 ${monthName} ${year} Agent Leaderboard`
          : `🏆 ${agencyName} ${monthName} ${year} Agent Leaderboard`

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
        .setTimestamp()

      await interaction.editReply({ embeds: [embed] })
      return
    }

    if (interaction.commandName === 'agency-leaderboard') {
      await interaction.deferReply()

      const { start, end, monthName, year } = getMonthRange()

      const { data, error } = await supabase
        .from('policy_submissions')
        .select('*')
        .eq('status', 'active')
        .gte('submitted_at', start)
        .lt('submitted_at', end)

      if (error) throw error

      const leaderboardRows = getLeaderboardRows(data)
      const agencyRows = buildAgencyRows(leaderboardRows)

      if (agencyRows.length === 0) {
        await interaction.editReply(`No agency production yet for ${monthName} ${year}.`)
        return
      }

      const agencyLeaderboard = agencyRows
        .map((agency, i) => {
          const medals = ['🥇', '🥈', '🥉']
          const displayAgencyName = getAgencyLeaderboardDisplayName(
            agency.agencyName
          )

          const amountText =
            i < 3 ? `**${formatMoney(agency.ap)} AP**` : `${formatMoney(agency.ap)} AP`

          return `${medals[i] || `#${i + 1}`} ${displayAgencyName} · ${amountText} · ${agency.activeAgents} ${activeAgentLabel(agency.activeAgents)}`
        })
        .join('\n')

      const totalPolicies = agencyRows.reduce((s, r) => s + r.policies, 0)
      const totalAP = agencyRows.reduce((s, r) => s + r.ap, 0)

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`🏢 ${monthName} ${year} Agency Leaderboard`)
        .setDescription(
          `ㅤ
ㅤ
${agencyLeaderboard}

📈 **${formatMoney(totalAP)}** Total AP
📄 **${totalPolicies}** Policies
🏢 **${agencyRows.length}** Active Agencies`
        )
        .setTimestamp()

      await interaction.editReply({ embeds: [embed] })
      return
    }

    if (interaction.commandName === 'daily-agency-leaderboard') {
      await interaction.deferReply()

      const dateInput = interaction.options.getString('date')
      const dayRange = getDayRange(dateInput)

      if (!dayRange) {
        await interaction.editReply('Enter the date like this: 06/01/2026 or 06-01-2026')
        return
      }

      const { start, end, dayName } = dayRange

      const { data, error } = await supabase
        .from('policy_submissions')
        .select('*')
        .eq('status', 'active')
        .gte('submitted_at', start)
        .lt('submitted_at', end)

      if (error) throw error

      const leaderboardRows = getLeaderboardRows(data)
      const agencyRows = buildAgencyRows(leaderboardRows)

      if (agencyRows.length === 0) {
        await interaction.editReply(`No agency production yet for ${dayName}.`)
        return
      }

      const agencyLeaderboard = agencyRows
        .map((agency, i) => {
          const medals = ['🥇', '🥈', '🥉']
          const displayAgencyName = getAgencyLeaderboardDisplayName(
            agency.agencyName
          )

          const amountText =
            i < 3 ? `**${formatMoney(agency.ap)} AP**` : `${formatMoney(agency.ap)} AP`

          return `${medals[i] || `#${i + 1}`} ${displayAgencyName} · ${amountText} · ${agency.activeAgents} ${activeAgentLabel(agency.activeAgents)}`
        })
        .join('\n')

      const totalPolicies = agencyRows.reduce((s, r) => s + r.policies, 0)
      const totalAP = agencyRows.reduce((s, r) => s + r.ap, 0)

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('🏢 Daily Agency Leaderboard')
        .setDescription(
          `📅 ${dayName}

${agencyLeaderboard}

📈 **${formatMoney(totalAP)} AP** Total
📄 **${totalPolicies}** Policies
🏢 **${agencyRows.length}** Active Agencies`
        )
        .setTimestamp()

      await interaction.editReply({ embeds: [embed] })
      return
    }

    if (interaction.commandName === 'daily-agent-leaderboard') {
      await interaction.deferReply()

      const dateInput = interaction.options.getString('date')
      const dayRange = getDayRange(dateInput)

      if (!dayRange) {
        await interaction.editReply('Enter the date like this: 06/01/2026 or 06-01-2026')
        return
      }

      const { start, end, dayName } = dayRange

      const { data, error } = await supabase
        .from('policy_submissions')
        .select('*')
        .eq('status', 'active')
        .gte('submitted_at', start)
        .lt('submitted_at', end)

      if (error) throw error

      const leaderboardRows = getLeaderboardRows(data)
      const allRows = buildAgentRows(leaderboardRows)
      const visibleRows = getVisibleAgentRows(allRows)

      if (allRows.length === 0) {
        await interaction.editReply(`No agent production yet for ${dayName}.`)
        return
      }

      if (visibleRows.length === 0) {
        await interaction.editReply(`No visible agent production yet for ${dayName}.`)
        return
      }
      
const agentLeaderboard = visibleRows
  .slice(0, AGENT_LEADERBOARD_LIMIT)
  .map((r, i) => {
          const medals = ['🥇', '🥈', '🥉']
          const displayAgencyName = getAgentAgencyDisplayName(r.agencyName)

          const amountText =
            i < 10 ? `**${formatMoney(r.ap)} AP**` : `${formatMoney(r.ap)} AP`

          return `${medals[i] || `#${i + 1}`} ${r.agentName} · ${displayAgencyName} · ${amountText}`
        })
        .join('\n')

      const totalPolicies = allRows.reduce((s, r) => s + r.policies, 0)
      const totalAP = allRows.reduce((s, r) => s + r.ap, 0)

      const embed = new EmbedBuilder()
        .setColor(0xf97316)
        .setTitle('🏆 Daily Agent Leaderboard')
        .setDescription(
          `📅 ${dayName}

${agentLeaderboard}

📈 **${formatMoney(totalAP)} AP** Total
📄 **${totalPolicies}** Policies
👥 **${visibleRows.length}** Active Agents`
        )
        .setTimestamp()

      await interaction.editReply({ embeds: [embed] })
      return
    }

    if (interaction.commandName === 'my-stats') {
      await interaction.deferReply({ ephemeral: true })

      const { start, end, monthName, year } = getMonthRange()

      const { data, error } = await supabase
        .from('policy_submissions')
        .select('*')
        .eq('status', 'active')
        .eq('discord_user_id', interaction.user.id)
        .gte('submitted_at', start)
        .lt('submitted_at', end)

      if (error) throw error

      const policies = getLeaderboardRows(data)
      const ap = policies.reduce((s, r) => s + Number(r.annual_premium || 0), 0)
      const monthly = policies.reduce(
        (s, r) => s + Number(r.monthly_payment || 0),
        0
      )

      const embed = new EmbedBuilder()
        .setColor(0x38bdf8)
        .setTitle(`📊 My ${monthName} ${year} Stats`)
        .addFields(
          {
            name: '📄 Policies',
            value: String(policies.length),
            inline: true,
          },
          {
            name: '💵 Monthly Premium',
            value: formatMoney(monthly),
            inline: true,
          },
          {
            name: '💰 AP',
            value: formatMoney(ap),
            inline: true,
          }
        )
        .setTimestamp()

      await interaction.editReply({ embeds: [embed] })
      return
    }
  } catch (error) {
    console.error(error)

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Something went wrong. Check your VS Code terminal.')
    } else {
      await interaction.reply({
        content: 'Something went wrong. Check your VS Code terminal.',
        ephemeral: true,
      })
    }
  }
})

client.login(process.env.DISCORD_TOKEN)