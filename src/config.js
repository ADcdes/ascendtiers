export const requestChannelId = '1508639019620368476';

export const modes = {
  crystal: {
    label: 'Crystal',
    icon: 'Crystal',
    requestTitle: 'Evaluation Testing Waitlist',
    highResultsChannelId: '1508638929731977366',
    normalResultsChannelId: '1508638952351858892',
    verifiedRoleId: '1508647631172276274',
    testerRoles: {
      NA: '1508947437681774773',
      EU: '1508948222968856616'
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
  mace: {
    label: 'Mace',
    icon: 'Mace',
    requestTitle: 'Mace Evaluation Testing Waitlist',
    highResultsChannelId: '1508920599395963100',
    normalResultsChannelId: '1508920653481513081',
    verifiedRoleId: '1508980097540161687',
    testerRoles: {
      NA: '1508985255154028745',
      EU: '1508985272019456010'
    },
    tierRoles: {
      HT1: '1508979742555246782',
      LT1: '1508979785676886068',
      HT2: '1508979843319070740',
      LT2: '1508979911921238236',
      HT3: '1508979955709771946',
      LT3: '1508979982633009372',
      HT4: '1508980011368054906',
      LT4: '1508980031463096340',
      HT5: '1508980053973795019',
      LT5: '1508980071459848192'
    }
  }
};

export const tierChoices = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];
export const highResultTiers = new Set(['HT1', 'LT1', 'HT2', 'LT2', 'HT3']);
