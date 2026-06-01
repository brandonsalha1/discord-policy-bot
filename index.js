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

function isValidDate(dateString) {
  const regex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12][0-9]|3[01])\/(20\d{2})$/

  if (!regex.test(dateString)) {
    return false
  }

  const [month, day, year] = dateString.split('/').map(Number)
  const date = new Date(year, month - 1, day)

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
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

    if (interaction.commandName === 'submit-policy') {
      await interaction.deferReply({ ephemeral: true })

      const carrier = interaction.options.getString('carrier').trim()
      const monthlyPayment = interaction.options.getNumber('monthly-premium')
      const issueDate = interaction.options.getString('issue-date').trim()

      if (!monthlyPayment || monthlyPayment <= 0) {
        await interaction.editReply('Enter a valid monthly premium.')
        return
      }

      if (!isValidDate(issueDate)) {
        await interaction.editReply(
          'Issue date must be in MM/DD/YYYY format. Example: 06/01/2026'
        )
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

      await interaction.editReply('Policy submitted successfully 💰')
      return
    }

    if (interaction.commandName === 'leaderboard') {
      await interaction.deferReply()

      const { start, end, monthName, year } = getMonthRange()

      const { data, error } = await supabase
        .from('policy_submissions')
        .select('*')
        .eq('status', 'active')
        .gte('submitted_at', start)
        .lt('submitted_at', end)

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

      if (rows.length === 0) {
        await interaction.editReply(
          `No policies submitted yet for ${monthName} ${year}.`
        )
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

      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle(`🏆 ${monthName} ${year} Leaderboard`)
        .setDescription(
          `${topFive}\n\n━━━━━━━━━━━━━━━━━━\n\n📊 **Rest of Agents**\n\n${rest}`
        )
        .addFields(
          {
            name: '👥 Active Agents',
            value: String(rows.length),
            inline: true,
          },
          {
            name: '📄 Policies',
            value: String(totalPolicies),
            inline: true,
          },
          {
            name: '💰 Total AP',
            value: formatMoney(totalAP),
            inline: true,
          }
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