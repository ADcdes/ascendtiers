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
import { highResultTiers, highTestTiers, migrationChannelId, modes, supportPingRoleIds, testerCommandRoleIds, testingLeaderboardChannelId, tierChoices, websiteGameModes } from './config.js';
import { crystalRules, maceRules, swordRules } from './rules.js';
import { ensureWaitlist, loadState, profileKey, saveState } from './state.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const execFileAsync = promisify(execFile);
const gitPath = process.env.GIT_PATH ?? 'C:\\Program Files\\Git\\cmd\\git.exe';
const highCooldownMs = 30 * 24 * 60 * 60 * 1000;
const normalCooldownMs = 2 * 24 * 60 * 60 * 1000;
const testingLeaderboardRefreshMs = 30 * 60 * 1000;
const playerProfileRefreshMs = 60 * 60 * 1000;
const playerProfileRefreshDelayMs = 600;
const minecraftProfileLookupUrl = 'https://api.minecraftservices.com/minecraft/profile/lookup';
const minecraftSessionProfileUrl = 'https://sessionserver.mojang.com/session/minecraft/profile';
let githubSyncQueue = Promise.resolve();
let testingLeaderboardQueue = Promise.resolve();

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
const modeCommandEntries = Object.entries(modes);

function buildSetupCommand(modeKey, mode) {
  return new SlashCommandBuilder()
    .setName(`setup-${modeKey}-request`)
    .setDescription(`Post the ${mode.label} test request panel.`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
}

function buildApplicationSetupCommand(modeKey, mode) {
  return new SlashCommandBuilder()
    .setName(`setup-${modeKey}-applications`)
    .setDescription(`Post the ${mode.label} staff and tester application panel.`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
}

function buildSupportSetupCommand(modeKey, mode) {
  return new SlashCommandBuilder()
    .setName(`setup-${modeKey}-support`)
    .setDescription(`Post the ${mode.label} request-support panel (player reports, support, partnerships).`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
}

const commands = [
  ...modeCommandEntries.map(([modeKey, mode]) => buildSetupCommand(modeKey, mode)),
  ...modeCommandEntries.map(([modeKey, mode]) => buildApplicationSetupCommand(modeKey, mode)),
  ...modeCommandEntries.map(([modeKey, mode]) => buildSupportSetupCommand(modeKey, mode)),
  new SlashCommandBuilder()
    .setName('setup-migration-panel')
    .setDescription('Post the tier migration request panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('undo-result')
    .setDescription('Undo the most recent test result in this server.')
    .addUserOption((option) => option.setName('player').setDescription('Only undo this player if they were the latest matching result.').setRequired(false)),
  new SlashCommandBuilder()
    .setName('restrict-player')
    .setDescription('Permanently restrict a player, wipe website tiers, and ban them from this server.')
    .addUserOption((option) => option.setName('player').setDescription('Discord user to restrict').setRequired(true))
    .addStringOption((option) => option.setName('ign').setDescription('Minecraft username').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Restriction reason').setRequired(false)),
  new SlashCommandBuilder()
    .setName('retire')
    .setDescription('Retire a player from one game mode, or all of them if no mode is given.')
    .addUserOption((option) => option.setName('player').setDescription('Player to retire').setRequired(true))
    .addStringOption((option) => option.setName('mode').setDescription('Only retire this game mode\'s tier (omit to retire every active tier)').setRequired(false).addChoices(...modeChoices))
    .addStringOption((option) => option.setName('reason').setDescription('Optional retirement note').setRequired(false)),
  new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Show testing rules.')
    .addStringOption((option) => option.setName('mode').setDescription('Ruleset').setRequired(true).addChoices(...modeChoices)),
  new SlashCommandBuilder()
    .setName('migrate')
    .setDescription('Post a tier migration for a player in the migrations channel.')
    .addUserOption((option) => option.setName('player').setDescription('Discord user migrating').setRequired(true))
    .addStringOption((option) => option.setName('mode').setDescription('Mode they hold the tier in').setRequired(true).addChoices(...modeChoices))
    .addStringOption((option) => option.setName('tier').setDescription('Tier being migrated').setRequired(true).addChoices(...tierCommandChoices))
    .addStringOption((option) => option.setName('source').setDescription('Where they migrated from').setRequired(true)),
  new SlashCommandBuilder()
    .setName('cdreset')
    .setDescription('Clear a player\'s testing cooldown silently (no result message posted).')
    .addUserOption((option) => option.setName('player').setDescription('Discord user to reset').setRequired(true)),
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Open your tier testing queue for a region.')
    .addStringOption((option) => option.setName('region').setDescription('Queue region').setRequired(true).addChoices(...regionChoices)),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Mark yourself offline and stop testing a region.')
    .addStringOption((option) => option.setName('region').setDescription('Queue region').setRequired(true).addChoices(...regionChoices)),
  new SlashCommandBuilder()
    .setName('next')
    .setDescription('Bring the next queued player into an evaluation ticket.')
    .addStringOption((option) => option.setName('region').setDescription('Queue region').setRequired(true).addChoices(...regionChoices)),
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Post this tier test\'s result and close the ticket. Use inside a tier test ticket only.')
    .addStringOption((option) => option.setName('tier').setDescription('Tier being awarded').setRequired(true).addChoices(...tierCommandChoices))
    .addStringOption((option) => option.setName('outcome').setDescription('Override the auto-detected outcome (promoted/failed/demoted)').setRequired(false).addChoices(
      { name: 'Promoted', value: 'promoted' },
      { name: 'Failed', value: 'failed' },
      { name: 'Demoted', value: 'demoted' }
    ))
    .addStringOption((option) => option.setName('details').setDescription('Fight lines / extra notes. New lines are allowed.').setRequired(false)),
  new SlashCommandBuilder()
    .setName('passeval')
    .setDescription('Player passed their eval (3-1 or better) — opens a High Test ticket for them to fight for the tier.')
    .addUserOption((option) => option.setName('user').setDescription('Player who passed the eval').setRequired(true)),
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Add a user to this ticket channel.')
    .addUserOption((option) => option.setName('user').setDescription('User to add to the ticket').setRequired(true)),
  new SlashCommandBuilder()
    .setName('format')
    .setDescription('Format a Crystal tier test result post.')
    .addUserOption((option) => option.setName('player').setDescription('Discord user tested').setRequired(true))
    .addStringOption((option) => option.setName('ign').setDescription('Minecraft username').setRequired(true))
    .addStringOption((option) => option.setName('outcome').setDescription('Result outcome').setRequired(true).addChoices(
      { name: 'Failed', value: 'failed' },
      { name: 'Promoted', value: 'promoted' }
    ))
    .addStringOption((option) => option.setName('tier').setDescription('Tier tested').setRequired(true).addChoices(
      { name: 'HT1', value: 'HT1' },
      { name: 'LT1', value: 'LT1' },
      { name: 'HT2', value: 'HT2' },
      { name: 'LT2', value: 'LT2' },
      { name: 'HT3', value: 'HT3' }
    ))
    .addBooleanOption((option) => option.setName('passed-eval').setDescription('Tag this as a result that passed a prior evaluation').setRequired(false))
    .addStringOption((option) => option.setName('score').setDescription('Fight score, e.g. 3-1. Required with passed-eval.').setRequired(false))
    .addStringOption((option) => option.setName('tester').setDescription('Opposing tester name. Required with passed-eval.').setRequired(false))
    .addStringOption((option) => option.setName('fights').setDescription('Fight lines / notes, exactly as they should appear. New lines are allowed.').setRequired(false)),
  new SlashCommandBuilder()
    .setName('forceclose')
    .setDescription('Force close a region queue if a tester left it open.')
    .addStringOption((option) => option.setName('region').setDescription('Queue region').setRequired(true).addChoices(...regionChoices)),
  new SlashCommandBuilder()
    .setName('user-refresh')
    .setDescription('Refresh a player\'s Minecraft username and skin from their stored UUID.')
    .addUserOption((option) => option.setName('player').setDescription('Player to refresh').setRequired(true)),
  new SlashCommandBuilder()
    .setName('refresh-testing-leaderboard')
    .setDescription('Refresh the current monthly Crystal testing leaderboard.'),
  new SlashCommandBuilder()
    .setName('refresh-all-players')
    .setDescription('Refresh every player\'s Minecraft username and skin from Mojang right now.')
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
  refreshTestingLeaderboard().catch((error) => console.error(`Could not refresh testing leaderboard: ${error.message}`));
  setInterval(() => {
    refreshTestingLeaderboard().catch((error) => console.error(`Could not refresh testing leaderboard: ${error.message}`));
  }, testingLeaderboardRefreshMs);

  refreshAllPlayerProfiles().catch((error) => console.error(`Could not auto-refresh player profiles: ${error.message}`));
  setInterval(() => {
    refreshAllPlayerProfiles().catch((error) => console.error(`Could not auto-refresh player profiles: ${error.message}`));
  }, playerProfileRefreshMs);
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

  const setupMatch = commandName.match(/^setup-([a-z0-9-]+)-request$/);
  if (setupMatch && modes[setupMatch[1]]) {
    if (!(await assertModeGuild(interaction, setupMatch[1]))) return;
    await postRequestPanel(interaction, setupMatch[1]);
    return;
  }

  const applicationSetupMatch = commandName.match(/^setup-([a-z0-9-]+)-applications$/);
  if (applicationSetupMatch && modes[applicationSetupMatch[1]]) {
    if (!(await assertModeGuild(interaction, applicationSetupMatch[1]))) return;
    await postApplicationPanel(interaction, applicationSetupMatch[1]);
    return;
  }

  const supportSetupMatch = commandName.match(/^setup-([a-z0-9-]+)-support$/);
  if (supportSetupMatch && modes[supportSetupMatch[1]]) {
    if (!(await assertModeGuild(interaction, supportSetupMatch[1]))) return;
    await postSupportPanel(interaction, supportSetupMatch[1]);
    return;
  }

  if (commandName === 'setup-migration-panel') {
    await postMigrationPanel(interaction);
    return;
  }

  if (commandName === 'rules') {
    const mode = interaction.options.getString('mode', true);
    await sendLongEphemeral(interaction, getRulesText(mode));
    return;
  }

  if (commandName === 'undo-result') {
    await handleUndoResult(interaction);
    return;
  }

  if (commandName === 'restrict-player') {
    await handleRestrictPlayer(interaction);
    return;
  }

  if (commandName === 'retire') {
    await handleRetirePlayer(interaction);
    return;
  }

  if (commandName === 'migrate') {
    await handleMigrateCommand(interaction);
    return;
  }

  if (commandName === 'cdreset') {
    await handleCooldownReset(interaction);
    return;
  }

  if (commandName === 'add') {
    await handleAddToTicket(interaction);
    return;
  }

  if (commandName === 'format') {
    await handleFormatCommand(interaction);
    return;
  }

  if (commandName === 'forceclose') {
    await handleForceClose(interaction);
    return;
  }

  if (commandName === 'user-refresh') {
    await handleUserRefresh(interaction);
    return;
  }

  if (commandName === 'refresh-testing-leaderboard') {
    await handleTestingLeaderboardRefresh(interaction);
    return;
  }

  if (commandName === 'refresh-all-players') {
    await handleRefreshAllPlayers(interaction);
    return;
  }

  if (commandName === 'start' || commandName === 'stop') {
    const modeKey = resolveModeKeyForGuild(interaction.guildId);
    if (!modeKey) {
      await interaction.reply({ content: 'This server is not configured for a testing mode.', ephemeral: true });
      return;
    }
    await handleTesterStatus(interaction, modeKey, commandName === 'start' ? 'online' : 'offline');
    return;
  }

  if (commandName === 'next') {
    const modeKey = resolveModeKeyForGuild(interaction.guildId);
    if (!modeKey) {
      await interaction.reply({ content: 'This server is not configured for a testing mode.', ephemeral: true });
      return;
    }
    const region = interaction.options.getString('region', true);
    await acceptNextQueuePlayer(interaction, modeKey, region);
    return;
  }

  if (commandName === 'close') {
    await handleCloseTestTicket(interaction);
    return;
  }

  if (commandName === 'passeval') {
    await handlePassEval(interaction);
  }
}

function getRulesText(modeKey) {
  const exactRules = {
    crystal: crystalRules,
    sword: swordRules,
    mace: maceRules
  }[modeKey];

  if (exactRules) return exactRules;

  return swordRules.replace('AscendTiers Sword Ranked Ruleset', `AscendTiers ${modes[modeKey].label} Ranked Ruleset`);
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

async function postApplicationPanel(interaction, modeKey) {
  const mode = modes[modeKey];
  if (!mode.applicationChannelId) {
    await interaction.reply({ content: `Set ${mode.label}'s application channel ID first.`, ephemeral: true });
    return;
  }

  const channel = await interaction.guild.channels.fetch(mode.applicationChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: 'I could not find the applications channel.', ephemeral: true });
    return;
  }

  await channel.send({
    embeds: [buildApplicationPanelEmbed(modeKey)],
    components: [buildApplicationButtons(modeKey)]
  });

  await interaction.reply({ content: `${mode.label} application panel posted in <#${mode.applicationChannelId}>.`, ephemeral: true });
}

async function postSupportPanel(interaction, modeKey) {
  const mode = modes[modeKey];
  if (!mode.supportChannelId) {
    await interaction.reply({ content: `Set ${mode.label}'s support channel ID first (env var: ${modeKey.toUpperCase()}_SUPPORT_CHANNEL_ID).`, ephemeral: true });
    return;
  }

  const channel = await interaction.guild.channels.fetch(mode.supportChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: 'I could not find the request-support channel.', ephemeral: true });
    return;
  }

  await channel.send({
    embeds: [buildSupportPanelEmbed(modeKey)],
    components: [buildSupportButtons(modeKey)]
  });

  await interaction.reply({ content: `${mode.label} request-support panel posted in <#${mode.supportChannelId}>.`, ephemeral: true });
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
  await notifyFirstInQueue(interaction.guild, waitlist);
  await saveState(state);

  await interaction.editReply(`${mode.label} ${region} tester marked ${status}.`);
}

async function handleForceClose(interaction) {
  const modeKey = Object.keys(modes).find((key) => modes[key].guildId === interaction.guildId);
  if (!modeKey) {
    await interaction.reply({ content: 'This server is not configured for a testing mode.', ephemeral: true });
    return;
  }

  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can force close a queue.', ephemeral: true });
    return;
  }

  const region = interaction.options.getString('region', true);
  await interaction.deferReply({ ephemeral: true });

  const waitlist = ensureWaitlist(state, modeKey, region);
  waitlist.activeTesterIds = [];
  waitlist.queue = [];
  waitlist.lastFirstNotifiedId = null;
  waitlist.lastTestingSession = new Date().toISOString();

  await updateWaitlistMessage(interaction.guild, waitlist);
  await saveState(state);

  await interaction.editReply(`Force closed the ${modes[modeKey].label} ${region} queue. All testers were marked offline and the queue was cleared.`);
}

async function handleUserRefresh(interaction) {
  const modeKey = Object.keys(modes).find((key) => modes[key].guildId === interaction.guildId);
  if (!modeKey) {
    await interaction.reply({ content: 'This server is not configured for a testing mode.', ephemeral: true });
    return;
  }

  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can refresh player data.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const discordUser = interaction.options.getUser('player', true);
  const data = await readPlayersData();
  const key = Object.entries(data.players ?? {}).find(([, player]) => player.discordId === discordUser.id)?.[0];
  const player = key ? data.players[key] : null;

  if (!player) {
    await interaction.editReply(`${discordUser} does not have a website profile yet.`);
    return;
  }

  let minecraftProfile;
  try {
    minecraftProfile = player.uuid
      ? await getMinecraftProfileByUuid(player.uuid)
      : await getMinecraftProfileByName(player.ign ?? player.name ?? '');
  } catch (error) {
    await interaction.editReply(`I could not refresh ${discordUser}'s Minecraft profile. If they changed their username before UUID tracking was added, have them verify their account again.`);
    return;
  }

  const previousIgn = player.ign ?? player.name ?? 'Unknown';
  player.ign = minecraftProfile.name;
  player.uuid = minecraftProfile.uuid;
  player.skinUrl = minecraftProfile.skinUrl;
  player.skinUpdatedAt = new Date().toISOString();
  delete player.name;
  data.players[normalizePlayerKey(minecraftProfile.name)] = player;
  if (key !== normalizePlayerKey(minecraftProfile.name)) delete data.players[key];

  for (const [profileStateKey, profile] of Object.entries(state.profiles)) {
    if (profile.uuid === minecraftProfile.uuid || profile.discordId === discordUser.id || profileStateKey.includes(`:${discordUser.id}:`)) {
      profile.ign = minecraftProfile.name;
      profile.uuid = minecraftProfile.uuid;
      profile.skinUrl = minecraftProfile.skinUrl;
      profile.refreshedAt = new Date().toISOString();
    }
  }

  const pushed = await writePlayersData(data, `Refresh ${minecraftProfile.name} Minecraft profile`);
  await saveState(state);

  await interaction.editReply({
    content: `Refreshed **${previousIgn}** as **${minecraftProfile.name}**.${pushed ? ' Website data was synced to GitHub.' : ' Website data changed, but GitHub push failed; check bot logs.'}`,
    embeds: [buildMinecraftProfileEmbed('Minecraft Profile Refreshed', minecraftProfile)]
  });
}

async function handleTestingLeaderboardRefresh(interaction) {
  if (!(await assertModeGuild(interaction, 'crystal'))) return;
  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can refresh the testing leaderboard.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const leaderboard = await refreshTestingLeaderboard();
  await interaction.editReply(`Refreshed the ${leaderboard.monthLabel} testing leaderboard with ${leaderboard.testCount} completed test${leaderboard.testCount === 1 ? '' : 's'}.`);
}

async function handleRefreshAllPlayers(interaction) {
  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can refresh player data.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const changedCount = await refreshAllPlayerProfiles();
  await interaction.editReply(
    changedCount > 0
      ? `Refreshed the roster. ${changedCount} player${changedCount === 1 ? '' : 's'} had a username or skin change.`
      : 'Refreshed the roster. No usernames or skins had changed.'
  );
}

function testingLeaderboardMonth(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    year: 'numeric'
  }).formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value;
  const year = parts.find((part) => part.type === 'year')?.value;
  return { key: `${year}-${month}`, label: `${month} ${year}` };
}

function currentTestingLeaderboard() {
  const currentMonth = testingLeaderboardMonth(new Date());
  const totals = new Map();

  for (const entry of state.resultLog ?? []) {
    if (entry.mode !== 'crystal' || !entry.createdBy || !entry.createdAt) continue;
    const entryDate = new Date(entry.createdAt);
    if (Number.isNaN(entryDate.getTime()) || testingLeaderboardMonth(entryDate).key !== currentMonth.key) continue;
    totals.set(entry.createdBy, (totals.get(entry.createdBy) ?? 0) + 1);
  }

  const testers = [...totals.entries()]
    .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
    .slice(0, 10);
  const testCount = [...totals.values()].reduce((total, count) => total + count, 0);
  return { ...currentMonth, testers, testCount };
}

function buildTestingLeaderboardEmbed(leaderboard) {
  const lines = leaderboard.testers.length > 0
    ? leaderboard.testers.map(([testerId, count], index) => `**${index + 1}.** <@${testerId}> - **${count}** test${count === 1 ? '' : 's'}`)
    : ['No completed Crystal tests have been recorded this month yet.'];

  return new EmbedBuilder()
    .setColor(0xffc42e)
    .setTitle(`Testing Leaderboard - ${leaderboard.label}`)
    .setDescription(['**Most completed Crystal tests this month**', '', ...lines].join('\n'))
    .setFooter({ text: 'Updates automatically after each Crystal result.' })
    .setTimestamp();
}

function refreshTestingLeaderboard() {
  testingLeaderboardQueue = testingLeaderboardQueue
    .catch(() => {})
    .then(() => updateTestingLeaderboard());
  return testingLeaderboardQueue;
}

async function updateTestingLeaderboard() {
  const guild = await client.guilds.fetch(modes.crystal.guildId);
  const channel = await guild.channels.fetch(testingLeaderboardChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error('Testing leaderboard channel was not found.');
  }

  const leaderboard = currentTestingLeaderboard();
  const payload = { embeds: [buildTestingLeaderboardEmbed(leaderboard)] };
  state.testingLeaderboard ??= {};
  const saved = state.testingLeaderboard;
  const existing = saved.messageId
    ? await channel.messages.fetch(saved.messageId).catch(() => null)
    : null;

  if (existing) {
    await existing.edit(payload);
  } else {
    const message = await channel.send(payload);
    saved.messageId = message.id;
  }

  saved.channelId = channel.id;
  saved.monthKey = leaderboard.key;
  saved.updatedAt = new Date().toISOString();
  await saveState(state);
  return leaderboard;
}

function resolveModeKeyForGuild(guildId) {
  return Object.keys(modes).find((key) => modes[key].guildId === guildId);
}

// Shared by every command that posts a tier test result (the per-mode /*-result commands,
// /close, and /passeval) so the cooldown check, role assignment, website sync, embed post,
// and result logging only live in one place.
async function postTierResult({ interaction, modeKey, player, ign, outcome, tier, details }) {
  const mode = modes[modeKey];

  const cooldown = await getActiveCooldown(interaction.guildId, player.id, modeKey, ign);
  if (cooldown) {
    const message = cooldown.restricted
      ? `${player} is restricted and cannot test. Reason: ${cooldown.reason}`
      : `${player} is on ${mode.label} cooldown until <t:${cooldown.availableAt}:f> (<t:${cooldown.availableAt}:R>).`;
    return { ok: false, message };
  }

  const targetChannelId = highResultTiers.has(tier) ? mode.highResultsChannelId : mode.normalResultsChannelId;
  if (!targetChannelId) {
    return { ok: false, message: `Set ${mode.label}'s result channel IDs before posting results.` };
  }

  const channel = await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return { ok: false, message: 'I could not find the result channel for that tier.' };
  }

  const previousTierRoleIds = await getMemberModeTierRoleIds(interaction.guild, player.id, mode);

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

  const embed = buildResultEmbed({
    modeKey,
    user: player,
    ign,
    outcome,
    tier,
    details,
    testerId: interaction.user.id,
    previousRank: syncResult.previousTier,
    region: syncResult.region
  });
  const message = await channel.send({ content: `<@${player.id}>`, embeds: [embed] });
  await removeModeWaitlistRoles(interaction.guild, player.id, mode);
  removeUserFromAllQueues(player.id);
  await updateAllModeWaitlistMessages(interaction.guild, modeKey);

  state.resultLog.push({
    guildId: interaction.guildId,
    mode: modeKey,
    userId: player.id,
    ign,
    outcome,
    tier,
    details,
    channelId: channel.id,
    messageId: message.id,
    createdAt: new Date().toISOString(),
    createdBy: interaction.user.id,
    previousPlayerKey: syncResult.previousPlayerKey,
    playerKey: syncResult.playerKey,
    previousPlayer: syncResult.previousPlayer,
    previousTierRoleIds,
    websiteSynced: syncResult.updated,
    githubSynced: syncResult.pushed
  });
  await saveState(state);

  if (modeKey === 'crystal') {
    await refreshTestingLeaderboard().catch((error) => console.error(`Could not refresh testing leaderboard: ${error.message}`));
  }

  const syncText = syncResult.updated
    ? syncResult.pushed ? ' Website data was synced to GitHub.' : ' Website data changed, but GitHub push failed; check bot logs.'
    : ' Website tier data was unchanged.';

  return { ok: true, channel, syncText };
}

// The friendly one-step replacement for a tier test ticket: post the result (auto-detecting
// promoted/failed/demoted by comparing against the player's current tier when not given
// explicitly) and close the ticket, in a single command. Only works inside a real tier test
// ticket (topic "test:...") so it never touches application/support/partnership tickets.
async function handleCloseTestTicket(interaction) {
  const ticketContext = getTestTicketContext(interaction.channel);
  if (!ticketContext) {
    await interaction.reply({ content: 'This is not a tier test ticket. /close only works inside a ticket created from the queue.', ephemeral: true });
    return;
  }

  const mode = modes[ticketContext.modeKey];
  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: `Only tester staff roles can close ${mode.label} test tickets.`, ephemeral: true });
    return;
  }

  const player = await client.users.fetch(ticketContext.userId).catch(() => null);
  const ign = ticketContext.ign;
  if (!player || !ign) {
    await interaction.reply({ content: 'Could not resolve the player for this ticket.', ephemeral: true });
    return;
  }

  const tier = interaction.options.getString('tier', true);
  const details = interaction.options.getString('details') ?? '';
  let outcome = interaction.options.getString('outcome');

  if (!outcome) {
    const currentTier = await getPlayerCurrentTier(player.id, ign, ticketContext.modeKey);
    if (!currentTier) {
      outcome = 'promoted';
    } else {
      const currentIndex = tierChoices.indexOf(currentTier);
      const newIndex = tierChoices.indexOf(tier);
      outcome = newIndex < currentIndex ? 'promoted' : newIndex > currentIndex ? 'demoted' : 'failed';
    }
  }

  await interaction.deferReply({ ephemeral: true });

  const result = await postTierResult({ interaction, modeKey: ticketContext.modeKey, player, ign, outcome, tier, details });
  if (!result.ok) {
    await interaction.editReply(result.message);
    return;
  }

  await interaction.editReply(`Posted ${mode.label} ${tier} result (${outcome}) in <#${result.channel.id}>.${result.syncText} Closing this ticket...`);
  await interaction.channel.delete('Tier test closed with result').catch(() => {});
}

// A regular tester ran an informal eval match (best of 4/5) with the candidate outside the bot.
// If the candidate won 3-1 or better, /passeval just opens a High Test ticket for them to fight
// the real HT3 test in — it does not post any result or assign any tier itself.
async function handlePassEval(interaction) {
  const modeKey = resolveModeKeyForGuild(interaction.guildId);
  if (!modeKey) {
    await interaction.reply({ content: 'This server is not configured for a testing mode.', ephemeral: true });
    return;
  }

  const mode = modes[modeKey];
  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: `Only tester staff roles can pass a ${mode.label} evaluation.`, ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const profile = state.profiles[profileKey(interaction.guildId, targetUser.id, modeKey)];
  if (!profile) {
    await interaction.reply({ content: `${targetUser} hasn't verified their Minecraft username in this server yet.`, ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  const currentTier = member ? getHighestHighTier(member, mode) : null;

  await createHighTestTicket(interaction, modeKey, profile, currentTier, targetUser, 'Passed Evaluation Tests');
}

async function handleUndoResult(interaction) {
  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can undo results.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const player = interaction.options.getUser('player');
  const logIndex = findUndoableResultIndex(interaction.guildId, player?.id);
  if (logIndex === -1) {
    await interaction.editReply(player ? `No result found to undo for ${player}.` : 'No result found to undo in this server.');
    return;
  }

  const entry = state.resultLog[logIndex];
  const data = await readPlayersData();
  data.players ??= {};

  if (entry.previousPlayer) {
    if (entry.playerKey && entry.playerKey !== entry.previousPlayerKey) {
      delete data.players[entry.playerKey];
    }
    data.players[entry.previousPlayerKey] = entry.previousPlayer;
  } else if (entry.playerKey) {
    delete data.players[entry.playerKey];
  }

  const mode = modes[entry.mode];
  if (mode && (entry.outcome === 'promoted' || entry.outcome === 'demoted')) {
    await restoreTierRoles(interaction.guild, entry.userId, mode, entry.previousTierRoleIds ?? []);
  }

  if (entry.channelId && entry.messageId) {
    const channel = await interaction.guild.channels.fetch(entry.channelId).catch(() => null);
    const message = channel?.isTextBased()
      ? await channel.messages.fetch(entry.messageId).catch(() => null)
      : null;
    await message?.delete().catch(() => {});
  }

  state.resultLog.splice(logIndex, 1);
  const pushed = await writePlayersData(data, `Undo ${entry.ign} ${modes[entry.mode]?.label ?? entry.mode} result`);
  await saveState(state);
  if (entry.mode === 'crystal') {
    await refreshTestingLeaderboard().catch((error) => console.error(`Could not refresh testing leaderboard: ${error.message}`));
  }

  await interaction.editReply(`Undid ${entry.ign}'s ${modes[entry.mode]?.label ?? entry.mode} ${entry.tier} result.${pushed ? ' Website data was synced to GitHub.' : ' GitHub push failed; check bot logs.'}`);
}

async function handleRestrictPlayer(interaction) {
  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can restrict players.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const player = interaction.options.getUser('player', true);
  const ign = interaction.options.getString('ign', true);
  const reason = interaction.options.getString('reason') ?? 'Restricted from testing.';
  const data = await readPlayersData();
  const key = findPlayerDataKey(data, player.id, ign) ?? normalizePlayerKey(ign);
  const record = data.players[key] ?? {};

  record.ign = ign;
  record.discordId = player.id;
  record.region ??= 'NA';
  record.restricted = true;
  record.restrictReason = reason;
  record.restrictedAt = new Date().toISOString();
  record.tiers = {};
  record.lastTestedAt = {};
  data.players[key] = record;

  removeUserFromAllQueues(player.id);
  await removeKnownTierRoles(interaction.guild, player.id);
  await interaction.guild.members.ban(player.id, { reason: `Restricted: ${reason}` }).catch((error) => {
    throw new Error(`Could not ban ${player.tag}: ${error.message}`);
  });

  const pushed = await writePlayersData(data, `Restrict ${ign}`);
  await saveState(state);

  await interaction.editReply(`Restricted and banned **${ign}**. Their public tiers were wiped.${pushed ? ' Website data was synced to GitHub.' : ' GitHub push failed; check bot logs.'}`);
}

async function handleRetirePlayer(interaction) {
  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can retire players.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const discordUser = interaction.options.getUser('player', true);
  const reason = interaction.options.getString('reason')?.trim() ?? null;
  const modeKey = interaction.options.getString('mode');
  const websiteMode = modeKey ? getWebsiteModeName(modeKey) : null;

  const data = await readPlayersData();
  const key = Object.entries(data.players ?? {}).find(([, player]) => player.discordId === discordUser.id)?.[0];
  const player = key ? data.players[key] : null;

  if (!player) {
    await interaction.editReply(`${discordUser} does not have a website profile yet.`);
    return;
  }

  const activeTiers = player.tiers ?? {};

  if (websiteMode) {
    if (!activeTiers[websiteMode]) {
      await interaction.editReply(`**${player.ign ?? discordUser.username}** does not have an active ${websiteMode} tier to retire.`);
      return;
    }

    player.retiredTiers = { ...(player.retiredTiers ?? {}), [websiteMode]: activeTiers[websiteMode] };
    delete player.tiers[websiteMode];
    player.retiredAt = new Date().toISOString();
    player.retireReason = reason;
    await removeKnownTierRoleForMode(discordUser.id, modeKey);

    const pushed = await writePlayersData(data, `Retire ${player.ign ?? discordUser.username}'s ${websiteMode} tier`);
    await saveState(state);

    await interaction.editReply(`Retired **${player.ign ?? discordUser.username}**'s ${websiteMode} tier and moved it to their retired profile. Their other active tiers were left untouched.${pushed ? ' Website data was synced to GitHub.' : ' Website data changed, but GitHub push failed; check bot logs.'}`);
    return;
  }

  if (Object.keys(activeTiers).length === 0) {
    await interaction.editReply(`**${player.ign ?? discordUser.username}** has no active tiers to retire.`);
    return;
  }

  player.retiredTiers = { ...(player.retiredTiers ?? {}), ...activeTiers };
  player.tiers = {};
  player.retiredAt = new Date().toISOString();
  player.retireReason = reason;
  await removeKnownTierRolesEverywhere(discordUser.id);

  const pushed = await writePlayersData(data, `Retire ${player.ign ?? discordUser.username}`);
  await saveState(state);

  await interaction.editReply(`Retired **${player.ign ?? discordUser.username}** and moved ${Object.keys(activeTiers).length} active tier${Object.keys(activeTiers).length === 1 ? '' : 's'} to their retired profile across every game mode server.${pushed ? ' Website data was synced to GitHub.' : ' Website data changed, but GitHub push failed; check bot logs.'}`);
}

async function handleMigrateCommand(interaction) {
  if (!(await assertModeGuild(interaction, 'crystal'))) return;

  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can post migrations.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const player = interaction.options.getUser('player', true);
  const modeKeyOpt = interaction.options.getString('mode', true);
  const tier = interaction.options.getString('tier', true);
  const source = interaction.options.getString('source', true);
  const modeLabel = modes[modeKeyOpt]?.label ?? modeKeyOpt;

  const channel = await interaction.guild.channels.fetch(migrationChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.editReply('I could not find the migrations channel in this server.');
    return;
  }

  await channel.send({ embeds: [buildMigrationRequestEmbed(player.id, modeLabel, tier, source)] });

  state.migrationLog ??= [];
  state.migrationLog.push({
    userId: player.id,
    mode: modeKeyOpt,
    tier,
    source,
    postedBy: interaction.user.id,
    createdAt: new Date().toISOString()
  });
  await saveState(state);

  await interaction.editReply(`Migration posted in <#${migrationChannelId}> for ${player}.`);
}

async function handleCooldownReset(interaction) {
  const modeKey = Object.keys(modes).find((key) => modes[key].guildId === interaction.guildId);
  if (!modeKey) {
    await interaction.reply({ content: 'This server is not configured for a testing mode.', ephemeral: true });
    return;
  }

  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can reset cooldowns.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const mode = modes[modeKey];
  const player = interaction.options.getUser('player', true);
  const data = await readPlayersData();
  const key = Object.entries(data.players ?? {}).find(([, record]) => record.discordId === player.id)?.[0];

  if (!key) {
    await interaction.editReply(`No ${mode.label} record found for ${player}.`);
    return;
  }

  const record = data.players[key];
  const websiteMode = getWebsiteModeName(modeKey);
  if (record.lastTestedAt) delete record.lastTestedAt[websiteMode];
  if (record.lastTestedTier) delete record.lastTestedTier[websiteMode];
  record.restricted = false;
  record.restrictReason = null;

  const pushed = await writePlayersData(data, `Reset ${record.ign ?? player.id} ${mode.label} cooldown`);
  await saveState(state);

  await interaction.editReply(`Cleared **${record.ign ?? player.username}**'s ${mode.label} cooldown. They can be tested immediately.${pushed ? '' : ' GitHub push failed; check bot logs.'}`);
}

const ticketTopicTypes = ['test', 'high-test', 'application', 'support'];

function getTicketChannelContext(channel) {
  if (!channel?.topic) return null;
  const [type, modeKey] = channel.topic.split(':');
  if (!ticketTopicTypes.includes(type) || !modes[modeKey]) return null;
  return { type, modeKey };
}

async function handleAddToTicket(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!canUseTesterCommands(interaction.member)) {
    await interaction.editReply('Only tester staff roles can add users to a ticket.');
    return;
  }

  const ticketContext = getTicketChannelContext(interaction.channel);
  if (!ticketContext) {
    await interaction.editReply('Use this command inside a ticket channel.');
    return;
  }

  const user = interaction.options.getUser('user', true);

  await interaction.channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  await interaction.channel.send(`Added ${user} to this ticket.`);
  await interaction.editReply('Done.');
}

const formatTierNames = {
  HT1: 'High Tier 1',
  LT1: 'Low Tier 1',
  HT2: 'High Tier 2',
  LT2: 'Low Tier 2',
  HT3: 'High Tier 3'
};

async function handleFormatCommand(interaction) {
  if (!(await assertModeGuild(interaction, 'crystal'))) return;

  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can post formatted results.', ephemeral: true });
    return;
  }

  const player = interaction.options.getUser('player', true);
  const ign = interaction.options.getString('ign', true);
  const outcome = interaction.options.getString('outcome', true);
  const tier = interaction.options.getString('tier', true);
  const passedEval = interaction.options.getBoolean('passed-eval') ?? false;
  const score = interaction.options.getString('score');
  const tester = interaction.options.getString('tester');
  const fights = interaction.options.getString('fights');

  if (passedEval && (!score || !tester)) {
    await interaction.reply({ content: 'Include both `score` and `tester` when `passed-eval` is true.', ephemeral: true });
    return;
  }

  if (!passedEval && !fights) {
    await interaction.reply({ content: 'Include `fights`, or set `passed-eval` to true with a `score` and `tester`.', ephemeral: true });
    return;
  }

  const tierName = formatTierNames[tier] ?? tier;
  const headerLine = outcome === 'promoted' ? `**Promoted To ${tierName}**` : `**Failed ${tierName}**`;

  const evalBlock = passedEval
    ? outcome === 'promoted'
      ? `*Passed Evaluation*\n### __${tierName} Fight:__\n> Won ${score} ${tester}`
      : `*Passed Evaluation*\n### __${tierName} Fights:__\n> Lost ${score} vs. ${tester}`
    : null;

  const body = [evalBlock, fights].filter(Boolean).join('\n');
  const content = `<@${player.id}> - ${ign} - ${headerLine}\n${body}`;

  await interaction.reply({ content, allowedMentions: { users: [player.id] } });
}

async function handleButton(interaction) {
  const [prefix, action, modeKey] = interaction.customId.split(':');
  if (prefix !== 'ascend') return;

  if (action === 'migration') {
    await showMigrationModal(interaction);
    return;
  }

  // Handle universal close commands for all ticket types instantly
  if (action === 'supportClose' || action === 'appClose' || action === 'highTestClose') {
    await closeTicketChannel(interaction);
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

  if (action === 'confirmVerify') {
    await confirmVerification(interaction, modeKey);
    return;
  }

  if (action === 'cancelVerify') {
    await cancelVerification(interaction, modeKey);
    return;
  }

  if (action === 'application') {
    await showApplicationModal(interaction, modeKey, interaction.customId.split(':')[3]);
    return;
  }

  if (action === 'supportRequest') {
    await showSupportModal(interaction, modeKey, interaction.customId.split(':')[3]);
    return;
  }

  if (action === 'enter') {
    await enterWaitlistFromRequest(interaction, modeKey);
    return;
  }

  if (action === 'cooldown') {
    await showCooldown(interaction, modeKey);
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
  const [, action, modeKey, extra] = interaction.customId.split(':');

  if (action === 'migrationModal') {
    await handleMigrationModal(interaction);
    return;
  }

  if (action === 'applicationModal') {
    if (!(await assertModeGuild(interaction, modeKey))) return;
    await handleApplicationModal(interaction, modeKey, extra);
    return;
  }

  if (action === 'supportModal') {
    if (!(await assertModeGuild(interaction, modeKey))) return;
    await handleSupportModal(interaction, modeKey, extra);
    return;
  }

  if (action !== 'verifyModal') return;
  if (!(await assertModeGuild(interaction, modeKey))) return;

  const submittedIgn = interaction.fields.getTextInputValue('ign').trim();
  const region = interaction.fields.getTextInputValue('region').trim().toUpperCase();

  if (!['NA', 'EU'].includes(region)) {
    await interaction.reply({ content: 'Region must be `NA` or `EU`.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let minecraftProfile;
  try {
    minecraftProfile = await getMinecraftProfileByName(submittedIgn);
  } catch (error) {
    await interaction.editReply(`I could not find a Minecraft account named **${submittedIgn}**. Check the spelling and try again.`);
    return;
  }

  state.pendingVerifications ??= {};
  state.pendingVerifications[profileKey(interaction.guildId, interaction.user.id, modeKey)] = {
    ign: minecraftProfile.name,
    region,
    uuid: minecraftProfile.uuid,
    skinUrl: minecraftProfile.skinUrl,
    createdAt: new Date().toISOString()
  };
  await saveState(state);

  const mode = modes[modeKey];
  await interaction.editReply({
    embeds: [buildVerificationEmbed(mode, region, minecraftProfile)],
    components: [buildVerificationButtons(modeKey)]
  });
}

async function confirmVerification(interaction, modeKey) {
  const key = profileKey(interaction.guildId, interaction.user.id, modeKey);
  const pending = state.pendingVerifications?.[key];
  if (!pending) {
    await interaction.reply({ content: 'This verification request has expired. Please verify again.', ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  const mode = modes[modeKey];
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (mode.verifiedRoleId) await member.roles.add(mode.verifiedRoleId);

  state.profiles[key] = {
    ...pending,
    discordId: interaction.user.id,
    verifiedAt: new Date().toISOString()
  };
  delete state.pendingVerifications[key];
  const websiteSync = await syncVerifiedProfileToWebsite(interaction.user.id, pending);
  await saveState(state);

  await interaction.editReply({
    content: `Verified as **${pending.ign}** for **${mode.label} ${pending.region}**. Your UUID and skin will be used for future website updates.${websiteSync.updated ? websiteSync.pushed ? ' Your existing website profile was updated too.' : ' Your website profile changed, but the GitHub push failed; check bot logs.' : ''}`,
    embeds: [buildMinecraftProfileEmbed('Account Verified', pending)],
    components: []
  });
}

async function cancelVerification(interaction, modeKey) {
  const key = profileKey(interaction.guildId, interaction.user.id, modeKey);
  if (state.pendingVerifications?.[key]) {
    delete state.pendingVerifications[key];
    await saveState(state);
  }

  await interaction.update({
    content: 'Verification cancelled. You can start again whenever you are ready.',
    embeds: [],
    components: []
  });
}

// ==========================================
// NEW TICKETING SUPPORT FUNCTIONS ADDED HERE
// ==========================================

async function findExistingSupportTicket(guild, userId, modeKey, supportType) {
  await guild.channels.fetch();
  return [...guild.channels.cache.values()].find((channel) =>
    channel.type === ChannelType.GuildText
    && channel.topic === `support:${modeKey}:${supportType}:${userId}`
  );
}

async function createSupportTicket(interaction, modeKey, request) {
  await interaction.guild.roles.fetch();
  const reviewerRoleIds = supportPingRoleIds.filter((roleId) => interaction.guild.roles.cache.has(roleId));

  const channelName = `${request.type}-${interaction.user.username}`
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
    ...reviewerRoleIds
      .map((roleId) => ({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }))
  ];

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    topic: `support:${modeKey}:${request.type}:${interaction.user.id}`,
    permissionOverwrites
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${modes[modeKey].label} ${formatSupportType(request.type)}`)
    .setDescription(`Submitted by: <@${interaction.user.id}>`)
    .addFields(
      { name: 'Subject / Player', value: request.subject, inline: false },
      { name: 'Details', value: request.details, inline: false }
    )
    .setTimestamp();

  const closeButtonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ascend:supportClose')
      .setLabel('🔒 Close Ticket')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: [`<@${interaction.user.id}>`, ...reviewerRoleIds.map((roleId) => `<@&${roleId}>`)].join(' '),
    embeds: [embed],
    components: [closeButtonRow],
    allowedMentions: { users: [interaction.user.id], roles: reviewerRoleIds }
  });

  return channel;
}

// Universal close function to delete channel
async function closeTicketChannel(interaction) {
  await interaction.reply({ content: 'Closing this ticket channel...' }).catch(() => {});
  await interaction.channel.delete('Ticket closed via Close button').catch(() => {});
}

// ==========================================

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

async function showApplicationModal(interaction, modeKey, applicationType) {
  if (!['staff', 'tester'].includes(applicationType)) {
    await interaction.reply({ content: 'Unknown application type.', ephemeral: true });
    return;
  }

  const typeLabel = formatApplicationType(applicationType);
  const modal = new ModalBuilder()
    .setCustomId(`ascend:applicationModal:${modeKey}:${applicationType}`)
    .setTitle(`${modes[modeKey].label} ${typeLabel}`);

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
        .setLabel('Region')
        .setPlaceholder('NA, EU, AS, AU...')
        .setStyle(TextInputStyle.Short)
        .setMinLength(2)
        .setMaxLength(8)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('rank')
        .setLabel(applicationType === 'tester' ? 'Current rank / proof' : 'Relevant experience')
        .setPlaceholder(applicationType === 'tester' ? 'Example: LT3 Sword on PvPTiers' : 'Example: moderation, events, support')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(700)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('activity')
        .setLabel('Availability')
        .setPlaceholder('Timezone and usual active hours')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(700)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Why should we pick you?')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleApplicationModal(interaction, modeKey, applicationType) {
  await interaction.deferReply({ ephemeral: true });

  const application = {
    type: applicationType,
    ign: interaction.fields.getTextInputValue('ign').trim(),
    region: interaction.fields.getTextInputValue('region').trim(),
    rank: interaction.fields.getTextInputValue('rank').trim(),
    activity: interaction.fields.getTextInputValue('activity').trim(),
    reason: interaction.fields.getTextInputValue('reason').trim()
  };

  const existing = await findExistingApplicationTicket(interaction.guild, interaction.user.id, modeKey, applicationType);
  if (existing) {
    await interaction.editReply(`You already have an open ${formatApplicationType(applicationType).toLowerCase()} ticket: <#${existing.id}>.`);
    return;
  }

  const channel = await createApplicationTicket(interaction, modeKey, application);
  await interaction.editReply(`Created your ${formatApplicationType(applicationType).toLowerCase()} ticket: <#${channel.id}>.`);
}

const supportTypes = ['report', 'support', 'partnership'];

function formatSupportType(supportType) {
  if (supportType === 'report') return 'Player Report';
  if (supportType === 'partnership') return 'Partnership Request';
  return 'Support Request';
}

async function showSupportModal(interaction, modeKey, supportType) {
  if (!supportTypes.includes(supportType)) {
    await interaction.reply({ content: 'Unknown request type.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`ascend:supportModal:${modeKey}:${supportType}`)
    .setTitle(`${modes[modeKey].label} ${formatSupportType(supportType)}`);

  if (supportType === 'report') {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('subject')
          .setLabel('Player being reported (IGN or @)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('details')
          .setLabel('What happened? Include proof if you have it.')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );
  } else if (supportType === 'partnership') {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('subject')
          .setLabel('Server / community name')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('details')
          .setLabel('Proposal details')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );
  } else {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('subject')
          .setLabel('Short summary')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('details')
          .setLabel('What do you need help with?')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );
  }

  await interaction.showModal(modal);
}

async function handleSupportModal(interaction, modeKey, supportType) {
  await interaction.deferReply({ ephemeral: true });

  const request = {
    type: supportType,
    subject: interaction.fields.getTextInputValue('subject').trim(),
    details: interaction.fields.getTextInputValue('details').trim()
  };

  const existing = await findExistingSupportTicket(interaction.guild, interaction.user.id, modeKey, supportType);
  if (existing) {
    await interaction.editReply(`You already have an open ${formatSupportType(supportType).toLowerCase()} ticket: <#${existing.id}>.`);
    return;
  }

  const channel = await createSupportTicket(interaction, modeKey, request);
  await interaction.editReply(`Created your ${formatSupportType(supportType).toLowerCase()} ticket: <#${channel.id}>.`);
}

async function showCooldown(interaction, modeKey) {
  const profile = state.profiles[profileKey(interaction.guildId, interaction.user.id, modeKey)];
  if (!profile) {
    await interaction.reply({ content: 'Verify first so I know your Minecraft username and region.', ephemeral: true });
    return;
  }

  const cooldown = await getActiveCooldown(interaction.guildId, interaction.user.id, modeKey, profile.ign);
  await interaction.reply({
    content: cooldown
      ? formatCooldownMessage(cooldown, modes[modeKey].label)
      : `You are not on ${modes[modeKey].label} cooldown. You can test now.`,
    ephemeral: true
  });
}

function formatCooldownMessage(cooldown, modeLabel) {
  if (cooldown.restricted) {
    return `You are restricted and cannot test. Reason: ${cooldown.reason}`;
  }

  return `You are on ${modeLabel} cooldown until <t:${cooldown.availableAt}:f> (<t:${cooldown.availableAt}:R>). ${cooldown.cooldownDays ?? 30}-day cooldown between attempts at that tier range.`;
}

async function enterWaitlistFromRequest(interaction, modeKey) {
  const profile = state.profiles[profileKey(interaction.guildId, interaction.user.id, modeKey)];
  if (!profile) {
    await interaction.reply({ content: 'Verify first so I know your Minecraft username and region.', ephemeral: true });
    return;
  }

  const mode = modes[modeKey];
  const cooldown = await getActiveCooldown(interaction.guildId, interaction.user.id, modeKey, profile.ign);
  if (cooldown) {
    await interaction.reply({ content: formatCooldownMessage(cooldown, mode.label), ephemeral: true });
    return;
  }

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
  const profile = state.profiles[profileKey(interaction.guildId, interaction.user.id, modeKey)];

  if (profile) {
    const cooldown = await getActiveCooldown(interaction.guildId, interaction.user.id, modeKey, profile.ign);
    if (cooldown) {
      await interaction.reply({ content: formatCooldownMessage(cooldown, modes[modeKey].label), ephemeral: true });
      return;
    }
  }

  if (waitlist.activeTesterIds.length === 0) {
    await interaction.reply({ content: `No ${region} ${modes[modeKey].label} testers are online right now, so the queue is closed.`, ephemeral: true });
    return;
  }

  if (!waitlist.queue.includes(interaction.user.id)) {
    waitlist.queue.push(interaction.user.id);
  }

  await updateWaitlistMessage(interaction.guild, waitlist);
  await notifyFirstInQueue(interaction.guild, waitlist);
  await saveState(state);

  await interaction.reply({ content: `You are in the ${region} ${modes[modeKey].label} queue.`, ephemeral: true });
}

async function leaveQueue(interaction, modeKey, region) {
  const waitlist = ensureWaitlist(state, modeKey, region);
  waitlist.queue = waitlist.queue.filter((id) => id !== interaction.user.id);

  await updateWaitlistMessage(interaction.guild, waitlist);
  await notifyFirstInQueue(interaction.guild, waitlist);
  await saveState(state);

  await interaction.reply({ content: `You left the ${region} ${modes[modeKey].label} queue.`, ephemeral: true });
}

async function acceptNextQueuePlayer(interaction, modeKey, region, options = {}) {
  const mode = modes[modeKey];
  if (!canUseTesterCommands(interaction.member)) {
    await interaction.reply({ content: 'Only tester staff roles can accept queued players.', ephemeral: true });
    return null;
  }

  const waitlist = ensureWaitlist(state, modeKey, region);
  const userId = waitlist.queue[0];
  if (!userId) {
    await interaction.reply({ content: `There is nobody in the ${region} ${mode.label} queue.`, ephemeral: true }).catch(() => {});
    return null;
  }

  const profile = state.profiles[profileKey(interaction.guildId, userId, modeKey)];
  if (!profile) {
    waitlist.queue.shift();
    await updateWaitlistMessage(interaction.guild, waitlist);
    await saveState(state);
    await interaction.reply({ content: 'The first queued player is missing verification data, so I removed them from the queue.', ephemeral: true }).catch(() => {});
    return null;
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  waitlist.queue.shift();
  waitlist.lastFirstNotifiedId = null;
  const channel = await createQueueTestTicket(interaction, modeKey, region, userId, profile);
  await updateWaitlistMessage(interaction.guild, waitlist);
  await notifyFirstInQueue(interaction.guild, waitlist);
  await saveState(state);

  await interaction.editReply(`${options.skipped ? 'Skipped this ticket and accepted' : 'Accepted'} <@${userId}> into <#${channel.id}>.`).catch(() => {});
  return channel;
}

async function createQueueTestTicket(interaction, modeKey, region, userId, profile) {
  const mode = modes[modeKey];
  const channelName = `${profile.ign}-test`
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
      id: userId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels
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
    }
  ];

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    topic: `test:${modeKey}:${region}:${userId}:${interaction.user.id}:${profile.ign}`,
    permissionOverwrites
  });

  const currentTier = await getPlayerCurrentTier(userId, profile.ign, modeKey);

  await channel.send({
    content: `<@${userId}> <@${interaction.user.id}>\n-# Tester: run \`/close tier:<tier>\` here when the test is done to post the result and close this ticket in one step.`,
    embeds: [buildQueueTestEmbed(modeKey, userId, profile, interaction.user.id, currentTier)],
    allowedMentions: { users: [userId, interaction.user.id] }
  });

  state.testTickets ??= [];
  state.testTickets.push({
    guildId: interaction.guildId,
    mode: modeKey,
    region,
    userId,
    testerId: interaction.user.id,
    ign: profile.ign,
    channelId: channel.id,
    createdAt: new Date().toISOString()
  });

  await removeModeWaitlistRoles(interaction.guild, userId, mode);
  return channel;
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

async function notifyFirstInQueue(guild, waitlist) {
  const firstUserId = waitlist.queue[0];
  if (!firstUserId) {
    waitlist.lastFirstNotifiedId = null;
    return;
  }

  if (waitlist.activeTesterIds.length === 0 || waitlist.lastFirstNotifiedId === firstUserId) {
    return;
  }

  waitlist.lastFirstNotifiedId = firstUserId;
  const mode = modes[waitlist.mode];
  const user = await client.users.fetch(firstUserId).catch(() => null);
  await user?.send(`You are #1 in the ${waitlist.region} ${mode.label} queue in **${guild.name}**. A tester is available now.`).catch(() => {});
}

async function createApplicationTicket(interaction, modeKey, application) {
  await interaction.guild.roles.fetch();
  const reviewerRoleIds = supportPingRoleIds.filter((roleId) => interaction.guild.roles.cache.has(roleId));

  const channelName = `${application.type}-app-${application.ign}-${interaction.user.username}`
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
    ...reviewerRoleIds
      .map((roleId) => ({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }))
  ];

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    topic: `application:${modeKey}:${application.type}:${interaction.user.id}`,
    permissionOverwrites
  });

  const closeButtonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ascend:appClose')
      .setLabel('🔒 Close Ticket')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: [`<@${interaction.user.id}>`, ...reviewerRoleIds.map((roleId) => `<@&${roleId}>`)].join(' '),
    embeds: [buildApplicationTicketEmbed(modeKey, interaction.user.id, application)],
    components: [closeButtonRow],
    allowedMentions: { users: [interaction.user.id], roles: reviewerRoleIds }
  });

  state.applicationLog ??= [];
  state.applicationLog.push({
    guildId: interaction.guildId,
    mode: modeKey,
    type: application.type,
    userId: interaction.user.id,
    ign: application.ign,
    channelId: channel.id,
    createdAt: new Date().toISOString()
  });
  await saveState(state);

  return channel;
}

async function ensureTicketCategory(guild, name) {
  await guild.channels.fetch();
  const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === name);
  if (existing) return existing;
  return guild.channels.create({ name, type: ChannelType.GuildCategory });
}

// currentTier is the high tier the player already holds (self-service re-test), so by default
// the ticket goes under a category named for that tier (e.g. "HT2 Tests"). /passeval overrides
// categoryLabel to "Passed Evaluation Tests" since a fresh eval-passer has no high tier role yet.
async function createHighTestTicket(interaction, modeKey, profile, currentTier, targetUser = interaction.user, categoryLabel = currentTier ? `${currentTier} Tests` : 'Passed Evaluation Tests') {
  const mode = modes[modeKey];
  const isSelfService = targetUser.id === interaction.user.id;
  await interaction.deferReply({ ephemeral: true });
  await interaction.guild.roles.fetch();

  const existing = await findExistingHighTestTicket(interaction.guild, targetUser.id, modeKey);
  if (existing) {
    await interaction.editReply(isSelfService ? `You already have a high-test ticket: <#${existing.id}>.` : `${targetUser} already has a high-test ticket: <#${existing.id}>.`);
    return;
  }

  const category = await ensureTicketCategory(interaction.guild, categoryLabel).catch(() => null);

  const channelName = `high-test-${profile.ign}-${targetUser.username}`
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
      id: targetUser.id,
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
    topic: `high-test:${modeKey}:${targetUser.id}`,
    parent: category?.id,
    permissionOverwrites
  });

  await channel.send({
    content: `<@${targetUser.id}>\n-# Evaluator: use \`/format\` to post the result when the test is done, then press Close.`,
    embeds: [buildHighTestEmbed(modeKey, targetUser.id, profile.ign, profile.region, currentTier)],
    components: [buildHighTestButtons(modeKey, targetUser.id)]
  });

  await interaction.editReply(isSelfService ? `Created your private high-test ticket: <#${channel.id}>.` : `Opened a high-test ticket for ${targetUser}: <#${channel.id}>.`);
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

async function findExistingApplicationTicket(guild, userId, modeKey, applicationType) {
  await guild.channels.fetch();
  return [...guild.channels.cache.values()].find((channel) =>
    channel.type === ChannelType.GuildText
    && channel.topic === `application:${modeKey}:${applicationType}:${userId}`
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

function buildVerificationEmbed(mode, region, profile) {
  return buildMinecraftProfileEmbed(`Confirm Your ${mode.label} Account`, profile)
    .setDescription(`Is this your Minecraft account for the **${region}** region? Confirming stores its UUID so future username and skin changes stay connected to you.`);
}

function buildMinecraftProfileEmbed(title, profile) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(title)
    .setThumbnail(minecraftAvatarUrl(profile.uuid))
    .setImage(profile.skinUrl)
    .addFields(
      { name: 'Minecraft Username', value: profile.ign ?? profile.name, inline: true },
      { name: 'UUID', value: `\`${profile.uuid}\``, inline: false }
    );
}

function buildVerificationButtons(modeKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ascend:confirmVerify:${modeKey}`).setLabel('Yes, this is me').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ascend:cancelVerify:${modeKey}`).setLabel('Not me').setStyle(ButtonStyle.Secondary)
  );
}

function buildApplicationPanelEmbed(modeKey) {
  const mode = modes[modeKey];
  return new EmbedBuilder()
    .setColor(0xffd166)
    .setTitle(`${mode.label} Applications`)
    .setDescription([
      'Open an application ticket for staff or tier tester review.',
      '',
      '**Tester Requirements**',
      '- Active players',
      '- Unbiased and fair judgment',
      '- Mature behavior',
      '- Tested LT3 or higher on PvPTiers or MCTiers'
    ].join('\n'));
}

function buildApplicationButtons(modeKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ascend:application:${modeKey}:staff`)
      .setLabel('Staff Application')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ascend:application:${modeKey}:tester`)
      .setLabel('Tier Tester Application')
      .setStyle(ButtonStyle.Success)
  );
}

function buildSupportPanelEmbed(modeKey) {
  const mode = modes[modeKey];
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${mode.label} Request Support`)
    .setDescription([
      'Open a private ticket for one of the options below.',
      '',
      '**Player Report** — report rule-breaking or misconduct by a player',
      '**Support** — general help, questions, or issues',
      '**Partnership** — propose a partnership with another server/community'
    ].join('\n'));
}

function buildSupportButtons(modeKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ascend:supportRequest:${modeKey}:report`)
      .setLabel('Player Report')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ascend:supportRequest:${modeKey}:support`)
      .setLabel('Support')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ascend:supportRequest:${modeKey}:partnership`)
      .setLabel('Partnership')
      .setStyle(ButtonStyle.Secondary)
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
      `Current tier: **${currentTier ?? 'Unranked'}**`,
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
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ascend:highTestClose')
      .setLabel('🔒 Close Ticket')
      .setStyle(ButtonStyle.Danger)
  );
}

function buildQueueTestEmbed(modeKey, userId, profile, testerId, currentTier) {
  const mode = modes[modeKey];
  return new EmbedBuilder()
    .setColor(0xff2d2d)
    .setTitle('Tier Test')
    .setThumbnail(minecraftBustUrl(profile.ign))
    .addFields(
      { name: 'Username', value: profile.ign, inline: false },
      { name: 'Preferred Server', value: `${mode.label} Ranked`, inline: false },
      { name: 'Region', value: profile.region, inline: false },
      { name: 'Current Tier', value: currentTier ?? 'Unranked', inline: false },
      { name: 'Tester', value: `<@${testerId}>`, inline: false }
    )
    .setFooter({ text: `Testee: ${userId}` })
    .setTimestamp();
}

function buildApplicationTicketEmbed(modeKey, userId, application) {
  return new EmbedBuilder()
    .setColor(application.type === 'tester' ? 0x57f287 : 0x5865f2)
    .setTitle(`${modes[modeKey].label} ${formatApplicationType(application.type)}`)
    .setDescription(`Applicant: <@${userId}>`)
    .addFields(
      { name: 'Minecraft Username', value: application.ign, inline: true },
      { name: 'Region', value: application.region, inline: true },
      { name: application.type === 'tester' ? 'Current Rank / Proof' : 'Relevant Experience', value: application.rank || 'None provided', inline: false },
      { name: 'Availability', value: application.activity || 'None provided', inline: false },
      { name: 'Why should we pick you?', value: application.reason || 'None provided', inline: false }
    )
    .setTimestamp();
}

function formatApplicationType(applicationType) {
  return applicationType === 'tester' ? 'Tier Tester Application' : 'Staff Application';
}

function buildResultEmbed({ modeKey, user, ign, outcome, tier, details, testerId, previousRank, region }) {
  const mode = modes[modeKey];
  const skinUrl = minecraftBustUrl(ign);
  const earnedText = outcome === 'failed'
    ? `Failed ${formatTier(tier)}`
    : formatTier(tier);

  const embed = new EmbedBuilder()
    .setColor(outcome === 'failed' ? 0xff5757 : 0xff2d2d)
    .setAuthor({ name: `${ign}'s Test Results 🏆`, iconURL: skinUrl })
    .setThumbnail(skinUrl)
    .addFields(
      { name: 'Tester:', value: `<@${testerId}>`, inline: false },
      { name: 'Region:', value: region ?? 'Unknown', inline: false },
      { name: 'Username:', value: ign, inline: false },
      { name: 'Previous Rank:', value: previousRank === 'Unranked' ? 'Unranked' : formatTier(previousRank), inline: false },
      { name: 'Rank Earned:', value: earnedText, inline: false }
    )
    .setFooter({ text: `${mode.label} result` })
    .setTimestamp();

  if (details?.trim()) {
    embed.addFields({ name: 'Notes:', value: details.trim().slice(0, 1024), inline: false });
  }

  return embed;
}

function minecraftBustUrl(ign) {
  return `https://mc-heads.net/body/${encodeURIComponent(ign)}/160`;
}

function minecraftAvatarUrl(uuid) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(uuid)}/160`;
}

function normalizeMinecraftUuid(uuid) {
  const normalized = String(uuid ?? '').replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) {
    throw new Error('Invalid Minecraft UUID.');
  }
  return normalized;
}

async function getMinecraftProfileByName(ign) {
  const response = await fetch(`${minecraftProfileLookupUrl}/name/${encodeURIComponent(ign)}`);
  if (!response.ok) throw new Error(`Minecraft lookup failed with ${response.status}.`);
  const identity = await response.json();
  return getMinecraftProfileByUuid(identity.id);
}

async function getMinecraftProfileByUuid(uuid) {
  const normalizedUuid = normalizeMinecraftUuid(uuid);
  const response = await fetch(`${minecraftProfileLookupUrl}/${normalizedUuid}`);
  if (!response.ok) throw new Error(`Minecraft lookup failed with ${response.status}.`);
  const identity = await response.json();

  let skinUrl = minecraftAvatarUrl(normalizedUuid);
  try {
    const sessionResponse = await fetch(`${minecraftSessionProfileUrl}/${normalizedUuid}`);
    if (sessionResponse.ok) {
      const sessionProfile = await sessionResponse.json();
      const textureProperty = sessionProfile.properties?.find((property) => property.name === 'textures');
      if (textureProperty?.value) {
        const textures = JSON.parse(Buffer.from(textureProperty.value, 'base64').toString('utf8'));
        skinUrl = textures.textures?.SKIN?.url?.replace(/^http:/, 'https:') ?? skinUrl;
      }
    }
  } catch {
    // UUID-based avatar rendering remains available when the skin service is unavailable.
  }

  return {
    name: identity.name,
    ign: identity.name,
    uuid: normalizeMinecraftUuid(identity.id),
    skinUrl
  };
}

// Walks every player on the roster, checks Mojang for their current username/skin,
// and updates + pushes players.json when anything changed. This is what keeps the
// website in sync automatically instead of relying on staff running /user-refresh
// for every player by hand.
async function refreshAllPlayerProfiles() {
  const data = await readPlayersData();
  const entries = Object.entries(data.players ?? {});
  let changedCount = 0;

  for (const [key, player] of entries) {
    const identifier = player.uuid || player.ign || player.name;
    if (!identifier) continue;

    let profile;
    try {
      profile = player.uuid
        ? await getMinecraftProfileByUuid(player.uuid)
        : await getMinecraftProfileByName(identifier);
    } catch (error) {
      console.error(`Could not refresh Minecraft profile for ${key}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, playerProfileRefreshDelayMs));
      continue;
    }

    const previousIgn = player.ign ?? player.name ?? null;
    const changed = previousIgn !== profile.name || player.skinUrl !== profile.skinUrl || player.uuid !== profile.uuid;

    if (changed) {
      player.ign = profile.name;
      player.uuid = profile.uuid;
      player.skinUrl = profile.skinUrl;
      player.skinUpdatedAt = new Date().toISOString();
      delete player.name;
      changedCount++;

      const newKey = normalizePlayerKey(profile.name);
      if (newKey !== key) {
        data.players[newKey] = player;
        delete data.players[key];
      }

      for (const [profileStateKey, stateProfile] of Object.entries(state.profiles)) {
        const sameAccount = stateProfile.uuid === profile.uuid
          || (player.discordId && (stateProfile.discordId === player.discordId || profileStateKey.includes(`:${player.discordId}:`)));
        if (sameAccount) {
          stateProfile.ign = profile.name;
          stateProfile.uuid = profile.uuid;
          stateProfile.skinUrl = profile.skinUrl;
          stateProfile.refreshedAt = new Date().toISOString();
        }
      }
    }

    // Small delay between lookups so a large roster doesn't get rate limited by Mojang.
    await new Promise((resolve) => setTimeout(resolve, playerProfileRefreshDelayMs));
  }

  if (changedCount > 0) {
    const pushed = await writePlayersData(data, `Auto-refresh ${changedCount} player Minecraft profile${changedCount === 1 ? '' : 's'}`);
    await saveState(state);
    console.log(`Auto-refreshed ${changedCount} player profile(s).${pushed ? ' Synced to GitHub.' : ' GitHub push failed; check bot logs.'}`);
  }

  return changedCount;
}

function formatTier(tier) {
  return tier.replace('HT', 'High Tier ').replace('LT', 'Low Tier ');
}

async function assignTierRole(guild, userId, mode, tier) {
  const member = await guild.members.fetch(userId);
  if (!mode.tierRoles[tier]) {
    throw new Error(`Missing role ID for ${mode.label} ${tier}.`);
  }
  const currentTierRoleIds = Object.values(mode.tierRoles);
  const rolesToRemove = member.roles.cache.filter((role) => currentTierRoleIds.includes(role.id));

  if (rolesToRemove.size > 0) {
    await member.roles.remove([...rolesToRemove.keys()]);
  }

  await member.roles.add(mode.tierRoles[tier]);
}

async function getMemberModeTierRoleIds(guild, userId, mode) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return [];

  const roleIds = new Set(Object.values(mode.tierRoles).filter(Boolean));
  return member.roles.cache.filter((role) => roleIds.has(role.id)).map((role) => role.id);
}

async function restoreTierRoles(guild, userId, mode, previousRoleIds) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  await guild.roles.fetch().catch(() => {});

  const currentTierRoleIds = Object.values(mode.tierRoles).filter(Boolean);
  const rolesToRemove = member.roles.cache.filter((role) => currentTierRoleIds.includes(role.id));
  if (rolesToRemove.size > 0) {
    await member.roles.remove([...rolesToRemove.keys()]).catch(() => {});
  }

  const rolesToAdd = previousRoleIds.filter((roleId) => guild.roles.cache.has(roleId));
  if (rolesToAdd.length > 0) {
    await member.roles.add(rolesToAdd).catch(() => {});
  }
}

async function removeKnownTierRoles(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  await guild.roles.fetch().catch(() => {});

  const knownRoleIds = new Set(Object.values(modes).flatMap((mode) => Object.values(mode.tierRoles)).filter(Boolean));
  const rolesToRemove = member.roles.cache.filter((role) => knownRoleIds.has(role.id));
  if (rolesToRemove.size > 0) {
    await member.roles.remove([...rolesToRemove.keys()]).catch(() => {});
  }
}

// Tier roles live in whichever mode's own server they belong to (Crystal roles only exist in the
// Crystal server, Sword roles only exist in the Sword server, etc). Retiring a player has to walk
// every server the bot is in, not just the one the /retire command was run from, or the player is
// left holding stale tier roles in the other game mode servers forever.
async function removeKnownTierRolesEverywhere(userId) {
  const guilds = [...client.guilds.cache.values()];
  await Promise.all(guilds.map((guild) => removeKnownTierRoles(guild, userId)));
}

// Removes just one mode's tier role, in that mode's own server, for a partial /retire.
async function removeKnownTierRoleForMode(userId, modeKey) {
  const mode = modes[modeKey];
  if (!mode?.guildId) return;
  const guild = client.guilds.cache.get(mode.guildId);
  if (!guild) return;

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  await guild.roles.fetch().catch(() => {});

  const roleIds = new Set(Object.values(mode.tierRoles ?? {}).filter(Boolean));
  const rolesToRemove = member.roles.cache.filter((role) => roleIds.has(role.id));
  if (rolesToRemove.size > 0) {
    await member.roles.remove([...rolesToRemove.keys()]).catch(() => {});
  }
}

async function removeModeWaitlistRoles(guild, userId, mode) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  const waitlistRoleIds = Object.values(mode.waitlistRoles ?? {}).filter(Boolean);
  const rolesToRemove = member.roles.cache.filter((role) => waitlistRoleIds.includes(role.id));
  if (rolesToRemove.size > 0) {
    await member.roles.remove([...rolesToRemove.keys()]).catch(() => {});
  }
}

async function updateAllModeWaitlistMessages(guild, modeKey) {
  const waitlists = Object.values(state.waitlists ?? {}).filter((waitlist) => waitlist.mode === modeKey);
  for (const waitlist of waitlists) {
    await updateWaitlistMessage(guild, waitlist).catch(() => {});
  }
}

function getTestTicketContext(channel) {
  if (!channel?.topic) return null;
  const [type, modeKey, region, userId, testerId, ...ignParts] = channel.topic.split(':');
  if (type !== 'test' || !modes[modeKey] || !userId || !testerId) return null;
  return {
    modeKey,
    region,
    userId,
    testerId,
    ign: ignParts.join(':')
  };
}

async function getPlayerCurrentTier(userId, ign, modeKey) {
  const data = await readPlayersData().catch(() => null);
  if (!data) return null;
  const key = findPlayerDataKey(data, userId, ign);
  if (!key) return null;
  return data.players[key]?.tiers?.[getWebsiteModeName(modeKey)] ?? null;
}

function findUndoableResultIndex(guildId, userId) {
  for (let index = state.resultLog.length - 1; index >= 0; index -= 1) {
    const entry = state.resultLog[index];
    if (entry.undoneAt) continue;
    if (entry.guildId && entry.guildId !== guildId) continue;
    if (userId && entry.userId !== userId) continue;
    return index;
  }

  return -1;
}

function findPlayerDataKey(data, userId, ign) {
  const normalizedIgn = normalizePlayerKey(ign ?? '');
  return Object.entries(data.players ?? {}).find(([, player]) =>
    player.discordId === userId || normalizePlayerKey(player.ign ?? player.name ?? '') === normalizedIgn
  )?.[0] ?? null;
}

function removeUserFromAllQueues(userId) {
  for (const waitlist of Object.values(state.waitlists ?? {})) {
    waitlist.queue = waitlist.queue.filter((id) => id !== userId);
  }
}

async function getActiveCooldown(guildId, userId, modeKey, ign) {
  const data = await readPlayersData();
  const key = findPlayerDataKey(data, userId, ign);
  if (!key) return null;

  const player = data.players[key];
  if (player.restricted) {
    return { restricted: true, reason: player.restrictReason ?? 'Restricted from testing.' };
  }

  const websiteMode = getWebsiteModeName(modeKey);
  const testedAt = player.lastTestedAt?.[websiteMode];
  if (!testedAt) return null;

  const testedTime = new Date(testedAt).getTime();
  if (Number.isNaN(testedTime)) return null;

  const testedTier = player.lastTestedTier?.[websiteMode];
  const cooldownMs = testedTier && highTestTiers.includes(testedTier) ? highCooldownMs : normalCooldownMs;

  const availableTime = testedTime + cooldownMs;
  if (Date.now() >= availableTime) return null;

  return { availableAt: Math.floor(availableTime / 1000), testedAt, cooldownDays: cooldownMs / (24 * 60 * 60 * 1000) };
}

async function syncVerifiedProfileToWebsite(userId, profile) {
  const data = await readPlayersData();
  const existingKey = Object.entries(data.players ?? {}).find(([, player]) =>
    player.discordId === userId || normalizePlayerKey(player.ign ?? player.name ?? '') === normalizePlayerKey(profile.ign)
  )?.[0];

  if (!existingKey) return { updated: false, pushed: false };

  const player = data.players[existingKey];
  const nextKey = normalizePlayerKey(profile.ign);
  const previous = JSON.stringify(player);
  player.ign = profile.ign;
  player.uuid = profile.uuid;
  player.skinUrl = profile.skinUrl;
  player.skinUpdatedAt = new Date().toISOString();
  delete player.name;

  if (existingKey !== nextKey) {
    delete data.players[existingKey];
  }
  data.players[nextKey] = player;

  const updated = previous !== JSON.stringify(player) || existingKey !== nextKey;
  return { updated, pushed: updated ? await writePlayersData(data, `Verify ${profile.ign} Minecraft profile`) : false };
}

async function updateWebsitePlayer({ guildId, modeKey, userId, ign, tier, outcome }) {
  const data = await readPlayersData();
  data.players ??= {};

  const profile = state.profiles[profileKey(guildId, userId, modeKey)];
  const resolvedIgn = profile?.ign ?? ign;
  const key = normalizePlayerKey(resolvedIgn);
  const existingKey = Object.entries(data.players).find(([, player]) =>
    player.discordId === userId || normalizePlayerKey(player.ign ?? player.name ?? '') === normalizePlayerKey(ign)
  )?.[0] ?? key;

  const player = data.players[existingKey] ?? {};
  const previousPlayer = data.players[existingKey] ? structuredClone(data.players[existingKey]) : null;
  const websiteMode = getWebsiteModeName(modeKey);
  const previousTier = player.tiers?.[websiteMode] ?? 'Unranked';
  const previous = JSON.stringify(player);

  player.ign = resolvedIgn;
  player.region = profile?.region ?? player.region ?? 'NA';
  player.discordId = userId;
  if (profile?.uuid) player.uuid = profile.uuid;
  if (profile?.skinUrl) player.skinUrl = profile.skinUrl;
  player.restricted ??= false;
  player.restrictReason ??= null;
  player.tiers ??= {};
  player.lastTestedAt ??= {};
  player.lastTestedAt[websiteMode] = new Date().toISOString();
  player.lastTestedTier ??= {};
  player.lastTestedTier[websiteMode] = tier;

  if (outcome === 'promoted' || outcome === 'demoted') {
    player.tiers[websiteMode] = tier;
    if (player.retiredTiers?.[websiteMode]) delete player.retiredTiers[websiteMode];
  }

  if (existingKey !== key) {
    delete data.players[existingKey];
  }
  data.players[key] = player;

  const changed = previous !== JSON.stringify(player) || existingKey !== key;
  if (!changed) {
    return {
      updated: false,
      pushed: false,
      previousTier,
      region: player.region,
      previousPlayerKey: existingKey,
      playerKey: key,
      previousPlayer
    };
  }

  const pushed = await writePlayersData(data, `Update ${ign} ${modes[modeKey].label} result`);
  return {
    updated: true,
    pushed,
    previousTier,
    region: player.region,
    previousPlayerKey: existingKey,
    playerKey: key,
    previousPlayer
  };
}

function getWebsiteModeName(modeKey) {
  return modeKey === 'crystal' ? 'Vanilla' : modes[modeKey].label;
}

async function readPlayersData() {
  const raw = await readFile('players.json', 'utf8');
  const data = JSON.parse(raw);
  data.players ??= {};
  return data;
}

async function writePlayersData(data, message) {
  await writeFile('players.json', `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return queueGithubSync(message);
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