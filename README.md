# AscendTiers

**The Minecraft PvP Tier List** — a tier testing platform with Discord bot integration and a GitHub Pages leaderboard.

---

## 🗂️ File Structure

```
ascendtiers/
├── index.html        ← Website (GitHub Pages)
├── players.json      ← Player data (updated by bot)
├── README.md
└── bot/
    ├── .env.example  ← Copy to .env and fill in values
    ├── package.json
    ├── index.js           ← Bot entry point
    ├── deploy-commands.js ← Run once to register slash commands
    ├── config.js
    ├── commands/
    │   ├── setup.js       ← /setup
    │   ├── testresult.js  ← /testresult
    │   ├── restrict.js    ← /restrict
    │   ├── unrestrict.js  ← /unrestrict
    │   └── help.js        ← /help
    ├── events/
    │   ├── ready.js
    │   └── interactionCreate.js
    └── utils/
        ├── github.js      ← GitHub API helpers
        └── tiers.js       ← Tier constants/helpers
```

---

## 🚀 Step 1 — GitHub Setup

1. Go to **github.com** and sign in
2. Click **+** → **New repository**
3. Name it: `ascendtiers`
4. Set to **Public**
5. Click **Create repository**
6. Upload all files from the root (`index.html`, `players.json`, `README.md`)
7. Go to **Settings → Pages → Source → Deploy from branch** → select `main` → `/ (root)` → **Save**
8. Your site will be live at: `https://YOUR_USERNAME.github.io/ascendtiers`

### Generate a GitHub Personal Access Token (for the bot):
1. Go to **github.com → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Give it a name like `ascendtiers-bot`
4. Check: `repo` (full control of private repositories)
5. Click **Generate token** — **copy it now**, you can't see it again!
6. Paste it into your bot `.env` as `GITHUB_TOKEN`

---

## 🤖 Step 2 — Discord Bot Setup

### Create the Application:
1. Go to **discord.com/developers/applications**
2. Click **New Application** → name it `AscendTiers`
3. Go to **Bot** tab → click **Add Bot**
4. Under **Token** → click **Reset Token** → copy it → paste into `.env` as `DISCORD_TOKEN`
5. Enable **Privileged Gateway Intents**: Server Members Intent, Message Content Intent
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Manage Roles`, `Manage Channels`, `Send Messages`, `Read Message History`, `Embed Links`, `Use Application Commands`
7. Copy the generated URL and open it to invite the bot to your server

### Get IDs:
- Enable **Developer Mode** in Discord: User Settings → Advanced → Developer Mode
- Right-click your server → **Copy Server ID** → paste as `GUILD_ID`
- Right-click the bot application → **Copy Application ID** → paste as `CLIENT_ID`

---

## 🏠 Step 3 — Discord Server Setup

### Create These Roles (Server Settings → Roles):

| Role Name          | Color (hex)  | Notes                                  |
|--------------------|--------------|----------------------------------------|
| Tier List Owner    | `#FF4444`    | Highest role, server owner             |
| Administrator      | `#E84040`    | Full bot access                        |
| Moderator          | `#4A70E8`    | Can restrict/unrestrict                |
| Helper             | `#10D4B0`    | Can view test results channel          |
| Voluntary Tester   | `#C879F0`    | Can use /testresult                    |
| **HT1**            | `#FFD700`    | Bright gold                            |
| **LT1**            | `#B8A020`    | Dim gold                               |
| **HT2**            | `#C8C8C8`    | Bright silver                          |
| **LT2**            | `#889090`    | Dim silver                             |
| **HT3**            | `#CD7F32`    | Bright bronze                          |
| **LT3**            | `#9B6025`    | Dim bronze                             |
| **HT4**            | `#4A9BE8`    | Bright blue                            |
| **LT4**            | `#7090C8`    | Dim blue                               |
| **HT5**            | `#60B0E0`    | Bright light-blue                      |
| **LT5**            | `#7090B0`    | Dim light-blue                         |
| Verified           | `#5a6880`    | Granted on account verification        |
| Member             | `#4A5060`    | Default for all members                |
| RESTRICTED         | `#FF0000`    | Added by /restrict, shown as red       |

> Make sure bot role is **above all tier roles** so it can assign them.

### Create These Channels:

**📋 INFO** (category)
- `#rules` — Everyone: View only
- `#announcements` — Everyone: View only. Admin: Send messages
- `#tier-list-info` — Everyone: View only

**🏠 GENERAL** (category)
- `#general` — Everyone: View + Send
- `#minecraft` — Everyone: View + Send
- `#off-topic` — Everyone: View + Send

**🔐 TESTING** (category)
- `#request-test` — Everyone (Verified): View + Send. Use /setup here!
  - RESTRICTED: No access
- `#test-results` (**PRIVATE**) — @everyone: NO. Tester/Helper/Mod/Admin: View + Send
- `#restrictions` — Everyone: View only. Mod+: Send messages

**📋 WAITLIST** (category — bot manages channels here)
- Leave empty; the bot creates `#[mode]-waitlist` channels automatically
- Set `WAITLIST_CATEGORY_ID` in `.env` to this category's ID

**🎙️ VOICE** (category)
- `General` — Everyone
- `Testing 1`, `Testing 2`, `Testing 3` — Tester + above only

### Copy All Role & Channel IDs into `.env`:
Right-click each role/channel → Copy ID → paste into the correct variable in `.env`

---

## ⚙️ Step 4 — Run the Bot

```bash
cd bot
npm install
cp .env.example .env
# Fill in .env with all your IDs and tokens

# Register slash commands (run once):
node deploy-commands.js

# Start the bot:
node index.js
```

### Hosting the Bot (so it runs 24/7):
Recommended options:
- **Railway** (free tier): railway.app — connect your GitHub repo, set env vars in dashboard
- **Render**: render.com — create a Web Service, set start command to `node index.js`
- **VPS**: Any Linux VPS with Node.js 18+ installed

---

## 🏆 Tier System

| Tier | Description         | Points |
|------|---------------------|--------|
| HT1  | High Tier 1 (Best)  | 100    |
| LT1  | Low Tier 1          | 80     |
| HT2  | High Tier 2         | 60     |
| LT2  | Low Tier 2          | 48     |
| HT3  | High Tier 3 ★       | 36     |
| LT3  | Low Tier 3 ★        | 26     |
| HT4  | High Tier 4         | 18     |
| LT4  | Low Tier 4          | 12     |
| HT5  | High Tier 5         | 8      |
| LT5  | Low Tier 5 (Entry)  | 4      |

★ = High Test required (LT3 and above)

---

## 📞 Support
Questions? Join the Discord!
