import 'dotenv/config';
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
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { highResultTiers, modes, tierChoices } from './config.js';
import { crystalRules, maceRules } from './rules.js';
import { ensureWaitlist, loadState, profileKey, saveState } from './state.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

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
    .setName('setup-mace-request')
    .setDescription('Post the Mace test request panel.')
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
    .setDescription('Show Crystal or Mace rules.')
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

  if (commandName === 'setup-mace-request') {
    if (!(await assertModeGuild(interaction, 'mace'))) return;
    await postRequestPanel(interaction, 'mace');
    return;
  }

  if (commandName === 'rules') {
    const mode = interaction.options.getString('mode', true);
    await sendLongEphemeral(interaction, mode === 'crystal' ? crystalRules : maceRules);
    return;
  }

  const testerMatch = commandName.match(/^(crystal|mace)-tester-(online|offline)$/);
  if (testerMatch) {
    if (!(await assertModeGuild(interaction, testerMatch[1]))) return;
    await handleTesterStatus(interaction, testerMatch[1], testerMatch[2]);
    return;
  }

  const resultMatch = commandName.match(/^(crystal|mace)-result$/);
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

async function handleTesterStatus(interaction, modeKey, status) {
  const region = interaction.options.getString('region', true);
  const mode = modes[modeKey];

  if (!memberHasRole(interaction.member, mode.testerRoles[region])) {
    await interaction.reply({ content: `Only the ${mode.label} ${region} waitlist role can use this command.`, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const waitlist = ensureWaitlist(state, modeKey, region);
  const testerId = interaction.user.id;

  if (status === 'online' && !waitlist.activeTesterIds.includes(testerId)) {
    waitlist.activeTesterIds.push(testerId);
  }

  if (status === 'offline') {
    const removedQueue = [...waitlist.queue];
    waitlist.activeTesterIds = waitlist.activeTesterIds.filter((id) => id !== testerId);
    waitlist.lastTestingSession = new Date().toISOString();
    if (waitlist.activeTesterIds.length === 0) {
      waitlist.queue = [];
      await revokeWaitlistAccess(interaction.guild, waitlist, removedQueue);
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

  if (!canManageResults(interaction.member, mode)) {
    await interaction.reply({ content: `Only ${mode.label} tester waitlist roles can post ${mode.label} results.`, ephemeral: true });
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

  state.resultLog.push({
    mode: modeKey,
    userId: player.id,
    ign,
    outcome,
    tier,
    details,
    channelId: channel.id,
    createdAt: new Date().toISOString(),
    createdBy: interaction.user.id
  });
  await saveState(state);

  await interaction.editReply(`Posted ${mode.label} ${tier} result in <#${channel.id}>.`);
}

async function handleButton(interaction) {
  const [prefix, action, modeKey] = interaction.customId.split(':');
  if (prefix !== 'ascend') return;
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
  }
}

async function handleModal(interaction) {
  const [, action, modeKey] = interaction.customId.split(':');
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
    content: `Verified as **${ign}** for **${mode.label} ${region}**. You can now enter the waitlist when a tester is online.`,
    ephemeral: true
  });
}

async function enterWaitlistFromRequest(interaction, modeKey) {
  const profile = state.profiles[profileKey(interaction.guildId, interaction.user.id, modeKey)];
  if (!profile) {
    await interaction.reply({ content: 'Verify first so I know your Minecraft username and region.', ephemeral: true });
    return;
  }

  await joinQueue(interaction, modeKey, profile.region);
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

  const channel = await updateWaitlistMessage(interaction.guild, waitlist);
  await channel.permissionOverwrites.edit(interaction.user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });
  await saveState(state);

  await interaction.reply({ content: `You are in the ${region} ${modes[modeKey].label} queue.`, ephemeral: true });
}

async function leaveQueue(interaction, modeKey, region) {
  const waitlist = ensureWaitlist(state, modeKey, region);
  waitlist.queue = waitlist.queue.filter((id) => id !== interaction.user.id);

  await updateWaitlistMessage(interaction.guild, waitlist);
  await revokeWaitlistAccess(interaction.guild, waitlist, [interaction.user.id]);
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

async function revokeWaitlistAccess(guild, waitlist, userIds) {
  if (userIds.length === 0) return;
  const channel = await findWaitlistChannel(guild, waitlist.mode, waitlist.region);
  if (!channel?.permissionOverwrites) return;

  for (const userId of userIds) {
    await channel.permissionOverwrites.delete(userId).catch(() => {});
  }
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
  return new EmbedBuilder()
    .setColor(modeKey === 'crystal' ? 0xff2d68 : 0x5865f2)
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

function memberHasRole(member, roleId) {
  return member.roles.cache.has(roleId);
}

function canManageResults(member, mode) {
  return Object.values(mode.testerRoles).some((roleId) => member.roles.cache.has(roleId));
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
