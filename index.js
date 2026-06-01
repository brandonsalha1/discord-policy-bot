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

function formatMoney(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0))
}

function getTodayIssueDate() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(new Date())
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

function getMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    monthName: now.toLocaleString('en-US', { month: 'long' }),
    year: now.getFullYear(),
  }
}

function getDayRange(dateInput) {
  let now

  if (dateInput) {
    const parts = dateInput.split('/')

    if (parts.length !== 3) {
      return null
    }

    const month = parseInt(parts[0], 10)
    const day = parseInt(parts[1], 10)
    const year = parseInt(parts[2], 10)

    now = new Date(year, month - 1, day)

    if (Number.isNaN(now.getTime())) {
      return null
    }
  } else {
    now = new Date()
  }

  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  )

  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  )

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    dayName: now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
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

function buildAgencyRows(data) {
  const map = new Map()

  for (const row of data || []) {
    const agencyName = row.agency_name || 'Unassigned Agency'

    if (!map.has(agencyName)) {
      map.set(agencyName, {
        agencyName,
        policies: 0,
        ap: 0,
      })
    }

    const current = map.get(agencyName)
    current.policies += 1
    current.ap += Number(row.annual_premium || 0)
  }

  return [...map.values()].sort((a, b) => b.ap - a.ap)
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

      if (!agency.ok) {
        await interaction.editReply(agency.message)
        return
      }

      const agencyName = agency.agencyName
      const generalChannelId = process.env.GENERAL_CHANNEL_ID
      const isGeneralChannel =
        generalChannelId && interaction.channel.id === generalChannelId

      let query = supabase
        .from('policy_submissions')
        .select('*')
        .eq('status', 'active')
        .gte('submitted_at', start)
        .lt('submitted_at', end)

      if (!isGeneralChannel) {
        query = query.eq('agency_name', agencyName)
      }

      const { data, error } = await query

      if (error) throw error

      const rows = buildAgentRows(data)

      if (rows.length === 0) {
        const emptyMessage = isGeneralChannel
          ? `No policies submitted yet for ${monthName} ${year}.`
          : `No policies submitted yet for ${agencyName} in ${monthName} ${year}.`

        await interaction.editReply(emptyMessage)
        return
      }

      const topTen = rows
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
        rows
          .slice(10)
          .map((r, i) => {
            const displayAgencyName = getAgentAgencyDisplayName(r.agencyName)

            return `#${i + 11} ${r.agentName} · ${displayAgencyName} · ${formatMoney(
              r.ap
            )} AP`
          })
          .join('\n') || ''

      const agentLeaderboard = `${topTen}${rest ? `\n${rest}` : ''}`

      const totalPolicies = rows.reduce((s, r) => s + r.policies, 0)
      const totalAP = rows.reduce((s, r) => s + r.ap, 0)

      const title = isGeneralChannel
        ? `🏆 ${monthName} ${year} Agent Leaderboard`
        : `🏆 ${agencyName} ${monthName} ${year} Agent Leaderboard`

      const embed = new EmbedBuilder()
        .setColor(isGeneralChannel ? 0xfacc15 : 0x16a34a)
        .setTitle(title)
        .setDescription(
          `🏆 Agent Leaderboard

${agentLeaderboard}

📈 **${formatMoney(totalAP)}** Total AP
📄 **${totalPolicies}** Policies
👥 **${rows.length}** Active Agents`
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

      const agencyRows = buildAgencyRows(data)

      if (agencyRows.length === 0) {
        await interaction.editReply(`No agency production yet for ${monthName} ${year}.`)
        return
      }

      const agencyLeaderboard = agencyRows
        .slice(0, 10)
        .map((agency, i) => {
          const medals = ['🥇', '🥈', '🥉']
          const displayAgencyName = getAgencyLeaderboardDisplayName(
            agency.agencyName
          )

          const amountText =
            i < 3 ? `**${formatMoney(agency.ap)} AP**` : `${formatMoney(agency.ap)} AP`

          return `${medals[i] || `#${i + 1}`} ${displayAgencyName} · ${amountText}`
        })
        .join('\n')

      const totalPolicies = agencyRows.reduce((s, r) => s + r.policies, 0)
      const totalAP = agencyRows.reduce((s, r) => s + r.ap, 0)

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`🏢 ${monthName} ${year} Agency Leaderboard`)
        .setDescription(
          `🏢 Agency Leaderboard

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
await interaction.editReply(
  'Enter the date like this: 06/01/2026'
)
}

const { start, end, dayName } = dayRange

      const { data, error } = await supabase
        .from('policy_submissions')
        .select('*')
        .eq('status', 'active')
        .gte('submitted_at', start)
        .lt('submitted_at', end)

      if (error) throw error

      const agencyRows = buildAgencyRows(data)

      if (agencyRows.length === 0) {
        await interaction.editReply(`No agency production yet for ${dayName}.`)
        return
      }

      const agencyLeaderboard = agencyRows
        .slice(0, 10)
        .map((agency, i) => {
          const medals = ['🥇', '🥈', '🥉']
          const displayAgencyName = getAgencyLeaderboardDisplayName(
            agency.agencyName
          )

          const amountText =
            i < 3 ? `**${formatMoney(agency.ap)} AP**` : `${formatMoney(agency.ap)} AP`

          return `${medals[i] || `#${i + 1}`} ${displayAgencyName} · ${amountText}`
        })
        .join('\n')

      const totalPolicies = agencyRows.reduce((s, r) => s + r.policies, 0)
      const totalAP = agencyRows.reduce((s, r) => s + r.ap, 0)

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle(`🏢 Daily Agency Leaderboard`)
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
    await interaction.editReply('Enter the date like this: 2026-06-01')
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

  const rows = buildAgentRows(data)

  if (rows.length === 0) {
    await interaction.editReply(`No agent production yet for ${dayName}.`)
    return
  }

  const agentLeaderboard = rows
    .slice(0, 10)
    .map((r, i) => {
      const medals = ['🥇', '🥈', '🥉']
      const displayAgencyName = getAgentAgencyDisplayName(r.agencyName)

      return `${medals[i] || `#${i + 1}`} ${r.agentName} · ${displayAgencyName} · **${formatMoney(
        r.ap
      )} AP**`
    })
    .join('\n')

  const totalPolicies = rows.reduce((s, r) => s + r.policies, 0)
  const totalAP = rows.reduce((s, r) => s + r.ap, 0)

  const embed = new EmbedBuilder()
    .setColor(0xf97316)
    .setTitle('🏆 Daily Agent Leaderboard')
    .setDescription(
      `📅 ${dayName}

${agentLeaderboard}

📈 **${formatMoney(totalAP)} AP** Total
📄 **${totalPolicies}** Policies
👥 **${rows.length}** Active Agents`
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

      const policies = data || []
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