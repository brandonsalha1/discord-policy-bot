require('dotenv').config()

const { REST, Routes, SlashCommandBuilder } = require('discord.js')

const commands = [
  new SlashCommandBuilder()
    .setName('sale')
    .setDescription('Submit a newly issued policy')
    .addStringOption((option) =>
      option
        .setName('carrier')
        .setDescription('Carrier name')
        .setRequired(true)
        .addChoices(
          { name: 'Aetna', value: 'Aetna' },
          { name: 'Aflac', value: 'Aflac' },
          { name: 'American Amicable', value: 'American Amicable' },
          { name: 'American Home Life', value: 'American Home Life' },
          { name: 'Baltimore Life', value: 'Baltimore Life' },
          { name: 'Combined', value: 'Combined' },
          { name: 'Corebridge', value: 'Corebridge' },
          { name: 'Ethos', value: 'Ethos' },
          { name: 'Guaranteed Trust Life', value: 'Guaranteed Trust Life' },
          { name: 'Instabrain', value: 'Instabrain' },
          { name: 'Liberty Bankers', value: 'Liberty Bankers' },
          { name: 'Mutual of Omaha', value: 'Mutual of Omaha' },
          { name: 'Polish Falcon', value: 'Polish Falcon' },
          { name: 'Royal Neighbors', value: 'Royal Neighbors' },
          { name: 'SBLI', value: 'SBLI' },
          { name: 'Transamerica', value: 'Transamerica' },
          { name: 'United Home Life', value: 'United Home Life' }
        )
    )
    .addNumberOption((option) =>
      option
        .setName('monthly-premium')
        .setDescription('Monthly premium')
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show this month’s agent leaderboard')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('agency-leaderboard')
    .setDescription('Show this month’s agency leaderboard')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('daily-agency-leaderboard')
    .setDescription('Show today’s agency leaderboard')
    .addStringOption((option) =>
      option
        .setName('date')
        .setDescription('Optional date in MM-DD-YYYY format')
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('daily-agent-leaderboard')
    .setDescription('Show today’s agent leaderboard')
    .addStringOption((option) =>
      option
        .setName('date')
        .setDescription('Optional date in MM-DD-YYYY format')
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('my-stats')
    .setDescription('Show your monthly stats')
    .toJSON(),
]

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN)

async function main() {
  try {
    console.log('Deploying slash commands...')

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    )

    console.log('Slash commands deployed successfully.')
  } catch (error) {
    console.error(error)
  }
}

main()