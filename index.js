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

function buildPolicyEmbed({
  carrier,
  monthlyPayment,
  annualPremium,
  agentName,
  agencyName,
}) {
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
        `🏛️ **${agencyName}**`,
      ].join('\n')
    )
    .setFooter({
      text: `Submitted by ${agentName}`,
    })
    .setTimestamp()
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

      const map = new Map()

      for (const row of data || []) {
        const key = row.discord_user_id

        if (!map.has(key)) {
          map.set(key, {
            agentName: row.agent_name,
            agencyName: row.agency_name,
            policies: 0,
            monthly: 0,
            ap: 0,
          })
        }

        const current = map.get(key)
        current.policies += 1
        current.monthly += Number(row.monthly_payment)
        current.ap += Number(row.annual_premium)
      }

      const rows = [...map.values()].sort((a, b) => b.ap - a.ap)

      const agencyMap = new Map()

      for (const row of rows) {
        if (!agencyMap.has(row.agencyName)) {
          agencyMap.set(row.agencyName, {
            agencyName: row.agencyName,
            policies: 0,
            ap: 0,
          })
        }

        const current = agencyMap.get(row.agencyName)
        current.policies += row.policies
        current.ap += row.ap
      }

      const agencyRows = [...agencyMap.values()].sort((a, b) => b.ap - a.ap)

      const agencyLeaderboard = agencyRows
        .slice(0, 10)
        .map((agency, i) => {
          const medals = ['🥇', '🥈', '🥉']

          return `${medals[i] || `#${i + 1}`} **${agency.agencyName}**\n${formatMoney(
            agency.ap
          )} AP • ${agency.policies} Policies`
        })
        .join('\n\n')

      if (rows.length === 0) {
        const emptyMessage = isGeneralChannel
          ? `No policies submitted yet for ${monthName} ${year}.`
          : `No policies submitted yet for ${agencyName} in ${monthName} ${year}.`

        await interaction.editReply(emptyMessage)
        return
      }

      const topFive = rows
        .slice(0, 5)
        .map((r, i) => {
          const topLabels = ['🥇 #1', '🥈 #2', '🥉 #3', '#4', '#5']
          return `${topLabels[i]} **${r.agentName}**\n${r.agencyName}\n**${formatMoney(
            r.ap
          )} AP** • ${r.policies} Policies`
        })
        .join('\n\n')

      const rest =
        rows
          .slice(5)
          .map(
            (r, i) =>
              `#${i + 6} **${r.agentName}** — ${r.agencyName}\n${formatMoney(
                r.ap
              )} AP • ${r.policies} Policies`
          )
          .join('\n\n') || 'No other agents yet.'

      const totalPolicies = rows.reduce((s, r) => s + r.policies, 0)
      const totalAP = rows.reduce((s, r) => s + r.ap, 0)

      const title = isGeneralChannel
        ? `🏆 ${monthName} ${year} Leaderboard`
        : `🏆 ${agencyName} ${monthName} ${year} Leaderboard`

     const embed = new EmbedBuilder()
  .setColor(isGeneralChannel ? 0xfacc15 : 0x16a34a)
  .setTitle(title)
  .setDescription(
`${topFive}

━━━━━━━━━━━━━━━━━━

📊 **Rest of Agents**

${rest}



━━━━━━━━━━━━━━━━━━

🏛️ **Agency Leaderboard**

${agencyLeaderboard}



━━━━━━━━━━━━━━━━━━

📈 **Company Totals**

👥 Active Agents: ${rows.length}
📄 Policies: ${totalPolicies}
💰 Total AP: ${formatMoney(totalAP)}`
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
      const ap = policies.reduce((s, r) => s + Number(r.annual_premium), 0)
      const monthly = policies.reduce(
        (s, r) => s + Number(r.monthly_payment),
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