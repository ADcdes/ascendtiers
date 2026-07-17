export const migrationChannelId = process.env.MIGRATION_CHANNEL_ID ?? '1509007513557798953';

// Roles pinged on new support (staff application) tickets, instead of the full tester roster.
export const supportPingRoleIds = [
  '1526038853423726715',
  '1508645264523530280'
];

function envList(name) {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function placeholderMode(label, envPrefix) {
  return {
    label,
    icon: label,
    guildId: process.env[`${envPrefix}_GUILD_ID`] ?? '',
    requestChannelId: process.env[`${envPrefix}_REQUEST_CHANNEL_ID`] ?? '',
    applicationChannelId: process.env[`${envPrefix}_APPLICATION_CHANNEL_ID`] ?? '',
    requestTitle: `${label} Evaluation Testing Waitlist`,
    highResultsChannelId: process.env[`${envPrefix}_HIGH_RESULTS_CHANNEL_ID`] ?? '',
    normalResultsChannelId: process.env[`${envPrefix}_NORMAL_RESULTS_CHANNEL_ID`] ?? '',
    verifiedRoleId: process.env[`${envPrefix}_VERIFIED_ROLE_ID`] ?? '',
    waitlistRoles: {
      NA: process.env[`${envPrefix}_NA_WAITLIST_ROLE_ID`] ?? '',
      EU: process.env[`${envPrefix}_EU_WAITLIST_ROLE_ID`] ?? ''
    },
    tierRoles: {
      HT1: process.env[`${envPrefix}_HT1_ROLE_ID`] ?? '',
      LT1: process.env[`${envPrefix}_LT1_ROLE_ID`] ?? '',
      HT2: process.env[`${envPrefix}_HT2_ROLE_ID`] ?? '',
      LT2: process.env[`${envPrefix}_LT2_ROLE_ID`] ?? '',
      HT3: process.env[`${envPrefix}_HT3_ROLE_ID`] ?? '',
      LT3: process.env[`${envPrefix}_LT3_ROLE_ID`] ?? '',
      HT4: process.env[`${envPrefix}_HT4_ROLE_ID`] ?? '',
      LT4: process.env[`${envPrefix}_LT4_ROLE_ID`] ?? '',
      HT5: process.env[`${envPrefix}_HT5_ROLE_ID`] ?? '',
      LT5: process.env[`${envPrefix}_LT5_ROLE_ID`] ?? ''
    }
  };
}

export const modes = {
  crystal: {
    label: 'Crystal',
    icon: 'Crystal',
    guildId: process.env.CRYSTAL_GUILD_ID ?? '1508638322820518009',
    requestChannelId: process.env.CRYSTAL_REQUEST_CHANNEL_ID ?? '1508639019620368476',
    applicationChannelId: process.env.CRYSTAL_APPLICATION_CHANNEL_ID ?? '1508638322820518009',
    requestTitle: 'Evaluation Testing Waitlist',
    highResultsChannelId: '1508638929731977366',
    normalResultsChannelId: '1508638952351858892',
    verifiedRoleId: '1508647631172276274',
    waitlistRoles: {
      NA: '1508993557065760768',
      EU: '1508994693386735687'
    },
    tierRoles: {
      HT1: '1508646801664901140',
      LT1: '1508646945198182560',
      HT2: '1508647025481093171',
      LT2: '1508647066530877481',
      HT3: '1508647144003731577',
      LT3: '1508647170750939148',
      HT4: '1508647198101864598',
      LT4: '1508647233502056579',
      HT5: '1508647251130454127',
      LT5: '1508647268134424817'
    }
  },
  ltms: placeholderMode('LTMs', 'LTMS'),
  uhc: placeholderMode('UHC', 'UHC'),
  pot: placeholderMode('Pot', 'POT'),
  nethop: placeholderMode('NethOP', 'NETHOP'),
  smp: placeholderMode('SMP', 'SMP'),
  sword: {
    label: 'Sword',
    icon: 'Sword',
    guildId: process.env.SWORD_GUILD_ID ?? '1510413936145596496',
    requestChannelId: process.env.SWORD_REQUEST_CHANNEL_ID ?? '1510415495868711002',
    applicationChannelId: process.env.SWORD_APPLICATION_CHANNEL_ID ?? '1510415526902497281',
    requestTitle: 'Sword Evaluation Testing Waitlist',
    highResultsChannelId: process.env.SWORD_HIGH_RESULTS_CHANNEL_ID ?? '1510415349370060920',
    normalResultsChannelId: process.env.SWORD_NORMAL_RESULTS_CHANNEL_ID ?? '1510415392407945226',
    verifiedRoleId: process.env.SWORD_VERIFIED_ROLE_ID ?? '1510417214996480173',
    waitlistRoles: {
      NA: process.env.SWORD_NA_WAITLIST_ROLE_ID ?? '1510417101033050212',
      EU: process.env.SWORD_EU_WAITLIST_ROLE_ID ?? '1510417145782075532'
    },
    tierRoles: {
      HT1: process.env.SWORD_HT1_ROLE_ID ?? '1510416624967094472',
      LT1: process.env.SWORD_LT1_ROLE_ID ?? '1510416684450844803',
      HT2: process.env.SWORD_HT2_ROLE_ID ?? '1510416749877530715',
      LT2: process.env.SWORD_LT2_ROLE_ID ?? '1510416823798071376',
      HT3: process.env.SWORD_HT3_ROLE_ID ?? '1510416885001228421',
      LT3: process.env.SWORD_LT3_ROLE_ID ?? '1510416955541164202',
      HT4: process.env.SWORD_HT4_ROLE_ID ?? '1510417003431727174',
      LT4: process.env.SWORD_LT4_ROLE_ID ?? '1510417024013303968',
      HT5: process.env.SWORD_HT5_ROLE_ID ?? '1510417044502347816',
      LT5: process.env.SWORD_LT5_ROLE_ID ?? '1510417070100185128'
    }
  },
  axe: placeholderMode('Axe', 'AXE'),
  mace: {
    label: 'Mace',
    icon: 'Mace',
    guildId: process.env.MACE_GUILD_ID ?? '1515086386443845753',
    requestChannelId: process.env.MACE_REQUEST_CHANNEL_ID ?? '1517616492689231912',
    applicationChannelId: process.env.MACE_APPLICATION_CHANNEL_ID ?? '1517616533159940187',
    requestTitle: 'Mace Evaluation Testing Waitlist',
    highResultsChannelId: '1517616369213116446',
    normalResultsChannelId: '1517616403803275514',
    verifiedRoleId: '1517618067713167432',
    waitlistRoles: {
      NA: '1517618017167609997',
      EU: '1517618045646934066'
    },
    tierRoles: {
      HT1: '1517617482431729714',
      LT1: '1517617535330160700',
      HT2: '1517617601298042890',
      LT2: '1517617640221315283',
      HT3: '1517617871788965918',
      LT3: '1517617898905014412',
      HT4: '1517617929984807083',
      LT4: '1517617939174526976',
      HT5: '1517617952944554124',
      LT5: '1517617972028506244'
    }
  }
};

export const tierChoices = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];
export const websiteGameModes = ['Vanilla', 'LTMs', 'UHC', 'Pot', 'NethOP', 'SMP', 'Sword', 'Axe', 'Mace'];
export const highResultTiers = new Set(['HT1', 'LT1', 'HT2', 'LT2', 'HT3']);
export const highTestTiers = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3'];
export const testerCommandRoleIds = [
  '1508646169683955754',
  '1508646454229471272',
  '1508646596466835486',
  '1508994896554627185',
  '1517617320954957874',
  '1517617346066518237',
  '1517617390148391134',
  ...envList('LTMS_TESTER_ROLE_IDS'),
  ...envList('UHC_TESTER_ROLE_IDS'),
  ...envList('POT_TESTER_ROLE_IDS'),
  ...envList('NETHOP_TESTER_ROLE_IDS'),
  ...envList('SMP_TESTER_ROLE_IDS'),
  ...envList('SWORD_TESTER_ROLE_IDS'),
  ...envList('AXE_TESTER_ROLE_IDS')
];
