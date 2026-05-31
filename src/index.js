import 'dotenv/config';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { highResultTiers, highTestTiers, migrationChannelId, modes, testerCommandRoleIds, tierChoices, websiteGameModes } from './config.js';
import { crystalRules, maceRules, swordRules } from './rules.js';
import { ensureWaitlist, loadState, profileKey, saveState } from './state.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const execFileAsync = promisify(execFile);
const gitPath = process.env.GIT_PATH ?? 'C:\\Program Files\\Git\\cmd\\git.exe';
let githubSyncQueue = Promise.resolve();

if (!token || !clientId) {
  throw new Error('Missing DISCORD_TOKEN or CLIENT_ID. Copy .env.example to .env and fill it in.');
}

let state = await loadState();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const modeChoices = Object.entries(modes).map(([value, mode]) => ({ name: mode.label, value }));
const regionChoices = [
  { name: 'NA', value: 'NA' },
  { name: 'EU', value: 'EU' }
];
const tierCommandChoices = tierChoices.map((tier) => ({ name: tier, value: tier }));

const commands = [
  new SlashCommandBuilder()
    .setName('setup-crystal-request')
    .setDescription('Post the Crystal test request panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('setup-sword-request')
    .setDescription('Post the Sword test request panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('setup-mace-request')
    .setDescription('Post the Mace test request panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('setup-migration-panel')
    .setDescription('Post the tier migration request panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('crystal-tester-online')
    .setDescription('Mark a Crystal tester online and open that regional waitlist.')
    .addStringOption((option) => option.setName('region').setDescription('Tester region').setRequired(true).addChoices(...regionChoices)),
  new SlashCommandBuilder()
    .setName('crystal-tester-offline')
    .setDescription('Mark a Crystal tester offline and update that regional waitlist.')
    .addStringOption((option) => option.setName('region').setDescription('Tester region').setRequired(true).addChoices(...regionChoices)),
  new SlashCommandBuilder()
    .setName('sword-tester-online')
    .setDescription('Mark a Sword tester online and open that regional waitlist.')
    .addStringOption((option) => option.setName('region').setDescription('Tester region').setRequired(true).addChoices(...regionChoices)),
  new SlashCommandBuilder()
    .setName('sword-tester-offline')
    .setDescription('Mark a Sword tester offline and update that regional waitlist.')
    .addStringOption((option) => option.setName('region').setDescription('Tester region').setRequired(true).addChoices(...regionChoices)),
  new SlashCommandBuilder()
    .setName('mace-tester-online')
    .setDescription('Mark a Mace tester online and open that regional waitlist.')
    .addStringOption((option) => option.setName('region').setDescription('Tester region').setRequired(true).addChoices(...regionChoices)),
  new SlashCommandBuilder()
    .setName('mace-tester-offline')
    .setDescription('Mark a Mace tester offline and update that regional waitlist.')
    .addStringOption((option) => option.setName('region').setDescription('Tester region').setRequired(true).addChoices(...regionChoices)),
  new SlashCommandBuilder()
    .setName('crystal-result')
    .setDescription('Post a Crystal test result and assign tier roles when needed.')
    .addUserOption((option) => option.setName('player').setDescription('Discord user tested').setRequired(true))
    .addStringOption((option) => option.setName('ign').setDescription('Minecraft username').setRequired(true))
    .addStringOption((option) => option.setName('outcome').setDescription('Result outcome').setRequired(true).addChoices(
      { name: 'Promoted', value: 'promoted' },
      { name: 'Failed', value: 'failed' },
      { name: 'Demoted', value: 'demoted' }
    ))
    .addStringOption((option) => option.setName('tier').setDescription('Result tier').setRequired(true).addChoices(...tierCommandChoices))
    .addStringOption((option) => option.setName('details').setDescription('Fight lines / extra notes. New lines are allowed.').setRequired(false)),
  new SlashCommandBuilder()
    .setName('sword-result')
    .setDescription('Post a Sword test result and assign tier roles when needed.')
    .addUserOption((option) => option.setName('player').setDescription('Discord user tested').setRequired(true))
    .addStringOption((option) => option.setName('ign').setDescription('Minecraft username').setRequired(true))
    .addStringOption((option) => option.setName('outcome').setDescription('Result outcome').setRequired(true).addChoices(
      { name: 'Promoted', value: 'promoted' },
      { name: 'Failed', value: 'failed' },
      { name: 'Demoted', value: 'demoted' }
    ))
    .addStringOption((option) => option.setName('tier').setDescription('Result tier').setRequired(true).addChoices(...tierCommandChoices))
    .addStringOption((option) => option.setName('details').setDescription('Fight lines / extra notes. New lines are allowed.').setRequired(false)),
  new SlashCommandBuilder()
    .setName('mace-result')
    .setDescription('Post a Mace test result and assign tier roles when needed.')
    .addUserOption((option) => option.setName('player').setDescription('Discord user tested').setRequired(true))
    .addStringOption((option) => option.setName('ign').setDescription('Minecraft username').setRequired(true))
    .addStringOption((option) => option.setName('outcome').setDescription('Result outcome').setRequired(true).addChoices(
      { name: 'Promoted', value: 'promoted' },
      { name: 'Failed', value: 'failed' },
      { name: 'Demoted', value: 'demoted' }
    ))
    .addStringOption((option) => option.setName('tier').setDescription('Result tier').setRequired(true).addChoices(...tierCommandChoices))
    .addStringOption((option) => option.setName('details').setDescription('Fight lines / extra notes. New lines are allowed.').setRequired(false)),
  new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Show Crystal, Sword, or Mace rules.')
    .addStringOption((option) => option.setName('mode').setDescription('Ruleset').setRequired(true).addChoices(...modeChoices))
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);
for (const guildId of new Set(Object.values(modes).map((mode) => mode.guildId).filter(Boolean))) {
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`Registered commands for guild ${guildId}`);
  } catch (error) {
    console.error(`Could not register commands for guild ${guildId}: ${error.message}`);
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    }
  } catch (error) {
    console.error(error);
    const message = 'Something went wrong while handling that. Check the bot console for details.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

async function handleCommand(interaction) {
  const commandName = interaction.commandName;

  if (commandName === 'setup-crystal-request') {
    if (!(await assertModeGuild(interaction, 'crystal'))) return;
    await postRequestPanel(interaction, 'crystal');
    return;
  }

  if (commandName === 'setup-sword-request') {
    if (!(await assertModeGuild(interaction, 'sword'))) return;
    await postRequestPanel(interaction, 'sword');
    return;
  }

  if (commandName === 'setup-mace-request') {
    if (!(await assertModeGuild(interaction, 'mace'))) return;
    await postRequestPanel(interaction, 'mace');
    return;
  }

  if (commandName === 'setup-migration-panel') {
    await postMigrationPanel(interaction);
    return;
  }

  if (commandName === 'rules') {
    const mode = interaction.options.getString('mode', true);
    const rules = {
      crystal: crystalRules,
      sword: swordRules,
      mace: maceRules
    }[mode];
    await sendLongEphemeral(interaction, rules);
    return;
  }

  const testerMatch = commandName.match(/^(crystal|sword|mace)-tester-(online|offline)$/);
  if (testerMatch) {
    if (!(await assertModeGuild(interaction, testerMatch[1]))) return;
    await handleTesterStatus(interaction, testerMatch[1], testerMatch[2]);
    return;
  }

  const resultMatch = commandName.match(/^(crystal|sword|mace)-result$/);
  if (resultMatch) {
    if (!(await assertModeGuild(interaction, resultMatch[1]))) return;
    await handleResult(interaction, resultMatch[1]);
  }
}

async function postRequestPanel(interaction, modeKey) {
  const mode = modes[modeKey];
  if (!mode.requestChannelId) {
    await interaction.reply({ content: `Set ${mode.label}'s request-test channel ID first.`, ephemeral: true });
    return;
  }

  const channel = await interaction.guild.channels.fetch(mode.requestChannelId);
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: 'I could not find the request-test channel.', ephemeral: true });
    return;
  }

  await channel.send({
    embeds: [buildRequestEmbed(modeKey)],
    components: [buildRequestButtons(modeKey)]
  });

  await interaction.reply({ content: `${mode.label} request panel posted in <#${mode.requestChannelId}>.`, ephemeral: true });
}

async function postMigrationPanel(interaction) {
  const channel = await interaction.guild.channels.fetch(migrationChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: 'I could not find the migrations channel in this server.', ephemeral: true });
    return;
  }

  await channel.send({
    embeds: [buildMigrationPanelEmbed()],
    components: [buildMigrationButton()]
  });

  await interaction.reply({ content: `Migration panel posted in <#${migrationChannelId}>.`, ephemeral: true });
}

async function handleTesterStatus(interaction, modeKey, status) {
  const region = interaction.options.getString('region', true);
  const mode = modes[modeKey];

  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can use this command.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const waitlist = ensureWaitlist(state, modeKey, region);
  const testerId = interaction.user.id;

  if (status === 'online' && !waitlist.activeTesterIds.includes(testerId)) {
    waitlist.activeTesterIds.push(testerId);
  }

  if (status === 'offline') {
    waitlist.activeTesterIds = waitlist.activeTesterIds.filter((id) => id !== testerId);
    waitlist.lastTestingSession = new Date().toISOString();
    if (waitlist.activeTesterIds.length === 0) {
      waitlist.queue = [];
    }
  }

  await updateWaitlistMessage(interaction.guild, waitlist, { pingHere: status === 'online' });
  await saveState(state);

  await interaction.editReply(`${mode.label} ${region} tester marked ${status}.`);
}

async function handleResult(interaction, modeKey) {
  const mode = modes[modeKey];
  const player = interaction.options.getUser('player', true);
  const ign = interaction.options.getString('ign', true);
  const outcome = interaction.options.getString('outcome', true);
  const tier = interaction.options.getString('tier', true);
  const details = interaction.options.getString('details') ?? '';

  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: `Only tester staff roles can post ${mode.label} results.`, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const targetChannelId = highResultTiers.has(tier) ? mode.highResultsChannelId : mode.normalResultsChannelId;
  const channel = await interaction.guild.channels.fetch(targetChannelId);

  if (!channel?.isTextBased()) {
    await interaction.editReply('I could not find the result channel for that tier.');
    return;
  }

  const embed = buildResultEmbed(modeKey, player.id, ign, outcome, tier, details, interaction.user.id);
  await channel.send({ content: `<@${player.id}>`, embeds: [embed] });

  if (outcome === 'promoted' || outcome === 'demoted') {
    await assignTierRole(interaction.guild, player.id, mode, tier);
  }

  const syncResult = await updateWebsitePlayer({
    guildId: interaction.guildId,
    modeKey,
    userId: player.id,
    ign,
    tier,
    outcome
  });

  state.resultLog.push({
    mode: modeKey,
    userId: player.id,
    ign,
    outcome,
    tier,
    details,
    channelId: channel.id,
    createdAt: new Date().toISOString(),
    createdBy: interaction.user.id,
    websiteSynced: syncResult.updated,
    githubSynced: syncResult.pushed
  });
  await saveState(state);

  const syncText = syncResult.updated
    ? syncResult.pushed ? ' Website data was synced to GitHub.' : ' Website data changed, but GitHub push failed; check bot logs.'
    : ' Website tier data was unchanged.';
  await interaction.editReply(`Posted ${mode.label} ${tier} result in <#${channel.id}>.${syncText}`);
}

async function handleButton(interaction) {
  const [prefix, action, modeKey] = interaction.customId.split(':');
  if (prefix !== 'ascend') return;

  if (action === 'migration') {
    await showMigrationModal(interaction);
    return;
  }

  if (!(await assertModeGuild(interaction, modeKey))) return;

  if (action === 'verify') {
    const modal = new ModalBuilder()
      .setCustomId(`ascend:verifyModal:${modeKey}`)
      .setTitle(`${modes[modeKey].label} Verification`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ign')
          .setLabel('Minecraft username')
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(16)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('region')
          .setLabel('Region: NA or EU')
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(2)
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  if (action === 'enter') {
    await enterWaitlistFromRequest(interaction, modeKey);
    return;
  }

  if (action === 'cooldown') {
    await interaction.reply({ content: 'Cooldown lookup is not connected yet. Failed tests are 30 days by default.', ephemeral: true });
    return;
  }

  if (action === 'joinQueue') {
    await joinQueue(interaction, modeKey, interaction.customId.split(':')[3]);
    return;
  }

  if (action === 'leaveQueue') {
    await leaveQueue(interaction, modeKey, interaction.customId.split(':')[3]);
    return;
  }

  if (action === 'acceptHighTest') {
    await acceptHighTest(interaction, modeKey, interaction.customId.split(':')[3]);
  }
}

async function handleModal(interaction) {
  const [, action, modeKey] = interaction.customId.split(':');

  if (action === 'migrationModal') {
    await handleMigrationModal(interaction);
    return;
  }

  if (action !== 'verifyModal') return;
  if (!(await assertModeGuild(interaction, modeKey))) return;

  const ign = interaction.fields.getTextInputValue('ign').trim();
  const region = interaction.fields.getTextInputValue('region').trim().toUpperCase();

  if (!['NA', 'EU'].includes(region)) {
    await interaction.reply({ content: 'Region must be `NA` or `EU`.', ephemeral: true });
    return;
  }

  const mode = modes[modeKey];
  const member = await interaction.guild.members.fetch(interaction.user.id);
  await member.roles.add(mode.verifiedRoleId);

  state.profiles[profileKey(interaction.guildId, interaction.user.id, modeKey)] = {
    ign,
    region,
    verifiedAt: new Date().toISOString()
  };
  await saveState(state);

  await interaction.reply({
    content: `Verified as **${ign}** for **${mode.label} ${region}**. You can now enter the waitlist.`,
    ephemeral: true
  });
}

async function showMigrationModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('ascend:migrationModal')
    .setTitle('Tier Migration');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('mode')
        .setLabel('Mode')
        .setPlaceholder('Vanilla, LTMs, UHC, Pot, NethOP...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tier')
        .setLabel('Tier')
        .setPlaceholder('HT1, LT1, HT2, LT2, HT3, LT3...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(3)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('source')
        .setLabel('Where did you migrate from?')
        .setPlaceholder('Server name or community')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
    )
  );

  await interaction.showModal(modal);
}

async function handleMigrationModal(interaction) {
  const mode = normalizeModeName(interaction.fields.getTextInputValue('mode'));
  const tier = interaction.fields.getTextInputValue('tier').trim().toUpperCase();
  const source = interaction.fields.getTextInputValue('source').trim();

  if (!tierChoices.includes(tier)) {
    await interaction.reply({ content: 'Tier must be one of: HT1, LT1, HT2, LT2, HT3, LT3, HT4, LT4, HT5, LT5.', ephemeral: true });
    return;
  }

  const channel = await interaction.guild.channels.fetch(migrationChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: 'I could not find the migrations channel in this server.', ephemeral: true });
    return;
  }

  await channel.send({
    embeds: [buildMigrationRequestEmbed(interaction.user.id, mode, tier, source)]
  });

  state.migrationLog ??= [];
  state.migrationLog.push({
    userId: interaction.user.id,
    mode,
    tier,
    source,
    createdAt: new Date().toISOString()
  });
  await saveState(state);

  await interaction.reply({ content: `Migration request sent in <#${migrationChannelId}>.`, ephemeral: true });
}

async function enterWaitlistFromRequest(interaction, modeKey) {
  const profile = state.profiles[profileKey(interaction.guildId, interaction.user.id, modeKey)];
  if (!profile) {
    await interaction.reply({ content: 'Verify first so I know your Minecraft username and region.', ephemeral: true });
    return;
  }

  const mode = modes[modeKey];
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const highTier = getHighestHighTier(member, mode);

  if (highTier) {
    await createHighTestTicket(interaction, modeKey, profile, highTier);
    return;
  }

  await member.roles.add(mode.waitlistRoles[profile.region]);
  const waitlist = ensureWaitlist(state, modeKey, profile.region);
  await updateWaitlistMessage(interaction.guild, waitlist);
  await saveState(state);

  await interaction.reply({
    content: `You now have access to the ${profile.region} ${mode.label} waitlist channel. Join the queue there when testers are online.`,
    ephemeral: true
  });
}

async function joinQueue(interaction, modeKey, region) {
  const waitlist = ensureWaitlist(state, modeKey, region);

  if (waitlist.activeTesterIds.length === 0) {
    await interaction.reply({ content: `No ${region} ${modes[modeKey].label} testers are online right now, so the queue is closed.`, ephemeral: true });
    return;
  }

  if (!waitlist.queue.includes(interaction.user.id)) {
    waitlist.queue.push(interaction.user.id);
  }

  await updateWaitlistMessage(interaction.guild, waitlist);
  await saveState(state);

  await interaction.reply({ content: `You are in the ${region} ${modes[modeKey].label} queue.`, ephemeral: true });
}

async function leaveQueue(interaction, modeKey, region) {
  const waitlist = ensureWaitlist(state, modeKey, region);
  waitlist.queue = waitlist.queue.filter((id) => id !== interaction.user.id);

  await updateWaitlistMessage(interaction.guild, waitlist);
  await saveState(state);

  await interaction.reply({ content: `You left the ${region} ${modes[modeKey].label} queue.`, ephemeral: true });
}

async function updateWaitlistMessage(guild, waitlist, options = {}) {
  const channel = await findWaitlistChannel(guild, waitlist.mode, waitlist.region);
  if (!channel?.isTextBased()) {
    throw new Error(`Could not find ${waitlist.region} waitlist channel.`);
  }

  waitlist.channelId = channel.id;

  const payload = {
    content: waitlist.activeTesterIds.length > 0 && options.pingHere ? '@here' : null,
    embeds: [buildWaitlistEmbed(waitlist)],
    components: waitlist.activeTesterIds.length > 0 ? [buildQueueButtons(waitlist.mode, waitlist.region)] : []
  };

  if (waitlist.messageId) {
    const existing = await channel.messages.fetch(waitlist.messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return channel;
    }
  }

  const message = await channel.send(payload);
  waitlist.messageId = message.id;
  return channel;
}

async function createHighTestTicket(interaction, modeKey, profile, currentTier) {
  const mode = modes[modeKey];
  await interaction.deferReply({ ephemeral: true });
  await interaction.guild.roles.fetch();

  const existing = await findExistingHighTestTicket(interaction.guild, interaction.user.id, modeKey);
  if (existing) {
    await interaction.editReply(`You already have a high-test ticket: <#${existing.id}>.`);
    return;
  }

  const channelName = `high-test-${profile.ign}-${interaction.user.username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);

  const permissionOverwrites = [
    {
      id: interaction.guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    },
    {
      id: client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels
      ]
    },
    ...testerCommandRoleIds
      .filter((roleId) => interaction.guild.roles.cache.has(roleId))
      .map((roleId) => ({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }))
  ];

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    topic: `high-test:${modeKey}:${interaction.user.id}`,
    permissionOverwrites
  });

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [buildHighTestEmbed(modeKey, interaction.user.id, profile.ign, profile.region, currentTier)],
    components: [buildHighTestButtons(modeKey, interaction.user.id)]
  });

  await interaction.editReply(`Created your private high-test ticket: <#${channel.id}>.`);
}

async function acceptHighTest(interaction, modeKey, playerId) {
  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can accept high tests.', ephemeral: true });
    return;
  }

  const channel = interaction.channel;
  await channel.permissionOverwrites.edit(interaction.user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  await interaction.reply({
    content: `<@${interaction.user.id}> accepted this high test for <@${playerId}>.`,
    allowedMentions: { users: [interaction.user.id, playerId] }
  });
}

async function findExistingHighTestTicket(guild, userId, modeKey) {
  await guild.channels.fetch();
  return [...guild.channels.cache.values()].find((channel) =>
    channel.type === ChannelType.GuildText
    && channel.topic === `high-test:${modeKey}:${userId}`
  );
}

async function findWaitlistChannel(guild, modeKey, region) {
  await guild.channels.fetch();
  const channels = [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildText);
  const regionLower = region.toLowerCase();
  const modeLower = modes[modeKey].label.toLowerCase();

  return channels.find((channel) => channel.name.toLowerCase() === `${regionLower}-waitlist-${modeLower}`)
    ?? channels.find((channel) => channel.name.toLowerCase() === `${regionLower}-${modeLower}-waitlist`)
    ?? channels.find((channel) => channel.name.toLowerCase() === `${regionLower}-waitlist`)
    ?? channels.find((channel) => channel.name.toLowerCase() === `${regionLower} waitlist`)
    ?? channels.find((channel) => channel.name.toLowerCase().includes(regionLower) && channel.name.toLowerCase().includes('waitlist') && channel.name.toLowerCase().includes(modeLower))
    ?? channels.find((channel) => channel.name.toLowerCase().includes(regionLower) && channel.name.toLowerCase().includes('waitlist'));
}

function buildRequestEmbed(modeKey) {
  const mode = modes[modeKey];
  const colors = {
    crystal: 0xff2d68,
    sword: 0x57f287,
    mace: 0x5865f2
  };

  return new EmbedBuilder()
    .setColor(colors[modeKey] ?? 0x5865f2)
    .setTitle(`${mode.requestTitle}`)
    .setDescription([
      'Upon applying, you will be added to a waitlist channel.',
      'Here you will be pinged when a tester of your region is available.',
      'If you are HT3 or higher, a high ticket will be created.',
      '',
      '- Region should be the region of the server you wish to test on',
      '',
      '- Username should be the name of the account you will be testing on',
      '',
      '**Failure to provide authentic information will result in a denied test.**'
    ].join('\n'));
}

function buildRequestButtons(modeKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ascend:verify:${modeKey}`).setLabel('Verify Account').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ascend:enter:${modeKey}`).setLabel('Enter Waitlist').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ascend:cooldown:${modeKey}`).setLabel('View Cooldown').setStyle(ButtonStyle.Primary)
  );
}

function buildMigrationPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x9aa8ff)
    .setTitle('Tier Migrations')
    .setDescription([
      'Use this if you have a tier from another server that you want reviewed for carry-over.',
      '',
      'Submit the mode, tier, and where the tier came from.'
    ].join('\n'));
}

function buildMigrationButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ascend:migration')
      .setLabel('Request Migration')
      .setStyle(ButtonStyle.Primary)
  );
}

function buildWaitlistEmbed(waitlist) {
  const mode = modes[waitlist.mode];

  if (waitlist.activeTesterIds.length === 0) {
    const lastSession = waitlist.lastTestingSession
      ? `<t:${Math.floor(new Date(waitlist.lastTestingSession).getTime() / 1000)}:f>`
      : 'None yet';

    return new EmbedBuilder()
      .setColor(0xff5757)
      .setTitle(`[1.21.1+] Minecraft ${mode.label} PvP Community`)
      .setDescription([
        '**No Testers Online**',
        '',
        `No ${waitlist.region} testers for your region are available at this time.`,
        'You will be pinged when a tester is available.',
        'Check back later!',
        '',
        `Last testing session: ${lastSession}`
      ].join('\n'));
  }

  const queueLines = waitlist.queue.length > 0
    ? waitlist.queue.slice(0, 20).map((id, index) => `${index + 1}. <@${id}>`).join('\n')
    : 'No players in queue yet.';

  const testerLines = waitlist.activeTesterIds.map((id, index) => `${index + 1}. <@${id}>`).join('\n');

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Tester(s) Available!')
    .setDescription([
      'The queue updates automatically.',
      'Use **Leave Queue** if you wish to be removed from the waitlist or queue.',
      '',
      `__Queue (${waitlist.queue.length}/20):__`,
      queueLines,
      '',
      '__Active Testers:__',
      testerLines
    ].join('\n'));
}

function buildQueueButtons(modeKey, region) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ascend:joinQueue:${modeKey}:${region}`).setLabel('Join Queue').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ascend:leaveQueue:${modeKey}:${region}`).setLabel('Leave Queue').setStyle(ButtonStyle.Secondary)
  );
}

function buildMigrationRequestEmbed(userId, mode, tier, source) {
  return new EmbedBuilder()
    .setColor(0xffd166)
    .setTitle('Migration Request')
    .addFields(
      { name: 'Player', value: `<@${userId}>`, inline: false },
      { name: 'Mode', value: mode, inline: true },
      { name: 'Tier', value: tier, inline: true },
      { name: 'Migrated From', value: source, inline: false }
    )
    .setTimestamp();
}

function buildHighTestEmbed(modeKey, userId, ign, region, currentTier) {
  const mode = modes[modeKey];
  const rulesSummary = [
    `High tests follow the ${mode.label} ranked ruleset.`,
    'HT3+ players should test through this private ticket.',
    'A tester must accept this ticket before the test proceeds.'
  ];

  return new EmbedBuilder()
    .setColor(0xffd166)
    .setTitle(`${mode.label} High Test Ticket`)
    .setDescription([
      `Player: <@${userId}>`,
      `IGN: **${ign}**`,
      `Region: **${region}**`,
      `Current tier: **${currentTier}**`,
      '',
      ...rulesSummary,
      '',
      'Tester staff: press **Accept High Test** if you agree to run this test.'
    ].join('\n'));
}

function buildHighTestButtons(modeKey, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ascend:acceptHighTest:${modeKey}:${userId}`)
      .setLabel('Accept High Test')
      .setStyle(ButtonStyle.Success)
  );
}

function buildResultEmbed(modeKey, userId, ign, outcome, tier, details, testerId) {
  const mode = modes[modeKey];
  const action = {
    promoted: `Promoted to **${formatTier(tier)}**`,
    failed: `Failed **${formatTier(tier)}**`,
    demoted: `Demoted to **${formatTier(tier)}**`
  }[outcome];

  const description = [
    `<@${userId}> - ${ign} - ${action}`,
    details?.trim() ? `\n${details.trim()}` : null
  ].filter(Boolean).join('\n');

  return new EmbedBuilder()
    .setColor(outcome === 'failed' ? 0xff5757 : 0x57f287)
    .setTitle(`${mode.icon} Test Result`)
    .setDescription(description)
    .setFooter({ text: `Submitted by ${testerId}` })
    .setTimestamp();
}

function formatTier(tier) {
  return tier.replace('HT', 'High Tier ').replace('LT', 'Low Tier ');
}

async function assignTierRole(guild, userId, mode, tier) {
  const member = await guild.members.fetch(userId);
  const currentTierRoleIds = Object.values(mode.tierRoles);
  const rolesToRemove = member.roles.cache.filter((role) => currentTierRoleIds.includes(role.id));

  if (rolesToRemove.size > 0) {
    await member.roles.remove([...rolesToRemove.keys()]);
  }

  await member.roles.add(mode.tierRoles[tier]);
}

async function updateWebsitePlayer({ guildId, modeKey, userId, ign, tier, outcome }) {
  const playersPath = 'players.json';
  const raw = await readFile(playersPath, 'utf8');
  const data = JSON.parse(raw);
  data.players ??= {};

  const key = normalizePlayerKey(ign);
  const existingKey = Object.entries(data.players).find(([, player]) =>
    player.discordId === userId || normalizePlayerKey(player.ign ?? player.name ?? '') === key
  )?.[0] ?? key;

  const profile = state.profiles[profileKey(guildId, userId, modeKey)];
  const player = data.players[existingKey] ?? {};
  const previous = JSON.stringify(player);

  player.ign = ign;
  player.region = profile?.region ?? player.region ?? 'NA';
  player.discordId = userId;
  player.restricted ??= false;
  player.restrictReason ??= null;
  player.tiers ??= {};

  if (outcome === 'promoted' || outcome === 'demoted') {
    player.tiers[getWebsiteModeName(modeKey)] = tier;
  }

  if (existingKey !== key) {
    delete data.players[existingKey];
  }
  data.players[key] = player;

  const next = `${JSON.stringify(data, null, 2)}\n`;
  const changed = previous !== JSON.stringify(player) || existingKey !== key;
  if (!changed) {
    return { updated: false, pushed: false };
  }

  await writeFile(playersPath, next, 'utf8');

  const pushed = await queueGithubSync(`Update ${ign} ${modes[modeKey].label} result`);
  return { updated: true, pushed };
}

function getWebsiteModeName(modeKey) {
  return modeKey === 'crystal' ? 'Vanilla' : modes[modeKey].label;
}

function normalizePlayerKey(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function normalizeModeName(value) {
  const trimmed = value.trim();
  return websiteGameModes.find((mode) => mode.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
}

async function queueGithubSync(message) {
  githubSyncQueue = githubSyncQueue
    .catch(() => {})
    .then(() => syncGithub(message));

  return githubSyncQueue;
}

async function syncGithub(message) {
  try {
    await runGit(['add', 'players.json']);
    const status = await runGit(['status', '--porcelain', 'players.json']);
    if (!status.stdout.trim()) return true;

    await runGit(['commit', '-m', message]);
    await runGit(['push', 'origin', 'main']);
    return true;
  } catch (error) {
    console.error(`GitHub sync failed: ${error.message}`);
    return false;
  }
}

async function runGit(args) {
  return execFileAsync(gitPath, args, { cwd: process.cwd(), windowsHide: true });
}

function canUseTesterCommands(member) {
  return testerCommandRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function getHighestHighTier(member, mode) {
  return highTestTiers.find((tier) => member.roles.cache.has(mode.tierRoles[tier]));
}

async function assertModeGuild(interaction, modeKey) {
  const mode = modes[modeKey];
  if (!mode) {
    await interaction.reply({ content: 'Unknown testing mode.', ephemeral: true });
    return false;
  }

  if (interaction.guildId !== mode.guildId) {
    await interaction.reply({
      content: `${mode.label} commands can only be used in the ${mode.label} server.`,
      ephemeral: true
    });
    return false;
  }

  return true;
}

async function sendLongEphemeral(interaction, text) {
  const chunks = text.match(/[\s\S]{1,1900}/g) ?? [text];
  await interaction.reply({ content: chunks.shift(), ephemeral: true });

  for (const chunk of chunks) {
    await interaction.followUp({ content: chunk, ephemeral: true });
  }
}

client.login(token);
