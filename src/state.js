import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dataDir = path.join(process.cwd(), 'data');
const statePath = path.join(dataDir, 'bot-state.json');

const defaultState = {
  profiles: {},
  pendingVerifications: {},
  waitlists: {},
  resultLog: []
};

export async function loadState() {
  await mkdir(dataDir, { recursive: true });

  try {
    const raw = await readFile(statePath, 'utf8');
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    await saveState(defaultState);
    return structuredClone(defaultState);
  }
}

export async function saveState(state) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function waitlistKey(mode, region) {
  return `${mode}:${region}`;
}

export function ensureWaitlist(state, mode, region) {
  const key = waitlistKey(mode, region);
  state.waitlists[key] ??= {
    mode,
    region,
    activeTesterIds: [],
    queue: [],
    channelId: null,
    messageId: null,
    lastTestingSession: null
  };
  return state.waitlists[key];
}

export function profileKey(guildId, userId, mode) {
  return `${guildId}:${userId}:${mode}`;
}
