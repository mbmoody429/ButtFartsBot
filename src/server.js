import express from "express";
import crypto from "crypto";
import { buttify, valid } from "./butts.js";

// # Public source showcase
// This file mirrors the main application flow used by ButtFartsBot.
// Production-only persistence, admin tooling, deployment configuration,
// and token storage are intentionally omitted from this public repo.

// # Twitch config
const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/$/, "");
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const EVENTSUB_SECRET = process.env.EVENTSUB_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const BOT_USER_ID = process.env.TWITCH_BOT_USER_ID;
let BOT_ACCESS_TOKEN = process.env.TWITCH_BOT_ACCESS_TOKEN;
let BOT_REFRESH_TOKEN = process.env.TWITCH_BOT_REFRESH_TOKEN;

const LETTER_SWAP_CHANCE = 0.65;
const CANNED_COOLDOWN_MS = 30_000;

// # Bot modes
const MODES = [
  { id: "butt", label: "Butt", sample: "classical buttification" },
  { id: "cock", label: "Cock", sample: "same bot, cockier" },
  { id: "fart", label: "Fart", sample: "a little more gaseous" },
  { id: "vagine", label: "Vagine", sample: "vagine. obviously." },
  { id: "no", label: "No", sample: "no means no means no" },
  { id: "uwu", label: "UwU", sample: "weaponized cuteness" },
  { id: "r_to_w", label: "R's → W's", sample: "wepwace some w's" },
  { id: "c_to_k", label: "C's → K's", sample: "khaotik spelling" },
];
const MODE_IDS = MODES.map(({ id }) => id);

// # Frequency settings
const FREQUENCIES = [
  { id: "a_lot", label: "A lot", rate: 15, sample: "about 1 in 15 messages" },
  { id: "good_amount", label: "A good amount", rate: 40, sample: "about 1 in 40 messages" },
  { id: "a_few", label: "A little bit", rate: 80, sample: "about 1 in 80 messages" },
];
const FREQUENCY_IDS = FREQUENCIES.map(({ id }) => id);

// # Canned chat responses
const GOOD_BOT_RESPONSES = [
  "hehe butt",
  "ty I work very hard",
  "good human",
  "I learned it from watching you",
  "finally, the recognition I deserve",
  "🫡🍑",
];

const MENTION_RESPONSES = [
  "you rang? 🍑",
  "that's my name don't wear it out",
  "I have been summoned",
  "what do you want I'm busy farting",
  "👁️👄👁️",
  "yes hello it is I, ButtFartsBot",
];

// # Showcase state
// Production persists this data. This public version keeps the structure visible
// without exposing production storage details.
const channels = {};
const cannedCooldowns = new Map();

function cleanModes(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(raw
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => MODE_IDS.includes(value)))];
}

function channelModes(userId) {
  const saved = cleanModes(channels[userId]?.modes);
  return saved.length ? saved : ["butt"];
}

function currentFrequency(userId) {
  const frequency = channels[userId]?.frequency;
  return FREQUENCY_IDS.includes(frequency) ? frequency : "good_amount";
}

function frequencyRate(userId) {
  return FREQUENCIES.find((item) => item.id === currentFrequency(userId))?.rate || 40;
}

function optedOut(channel, chatterId) {
  return Array.isArray(channel?.opted_out_users)
    && channel.opted_out_users.includes(String(chatterId));
}

// # Twitch API helpers
async function token(params) {
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  if (!response.ok) throw Error(await response.text());
  return response.json();
}

async function helix(path, accessToken, method = "GET", body) {
  const response = await fetch("https://api.twitch.tv/helix" + path, {
    method,
    headers: {
      "Client-Id": TWITCH_CLIENT_ID,
      Authorization: "Bearer " + accessToken,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body && JSON.stringify(body),
  });

  if (!response.ok) throw Error(await response.text());
  return response.status === 204 ? null : response.json();
}

async function appAccessToken() {
  const result = await token({
    client_id: TWITCH_CLIENT_ID,
    client_secret: TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  return result.access_token;
}

// # OAuth state signing
function signState(mode, extra = {}) {
  const body = Buffer.from(JSON.stringify({ mode, ...extra, t: Date.now() }))
    .toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");
  return body + "." + signature;
}

function readState(state) {
  const [body, signature] = String(state || "").split(".");
  if (!body || !signature) throw Error("Bad state");

  const expected = crypto.createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    suppliedBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw Error("Bad state");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url"));
  if (Date.now() - payload.t > 600_000) throw Error("Expired state");
  return payload;
}

function authUrl(mode, extra = {}) {
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: PUBLIC_URL + "/auth/callback",
    response_type: "code",
    scope: "channel:bot",
    state: signState(mode, extra),
  });
  return url.toString();
}

// # EventSub subscriptions
async function addSubscription(broadcasterId) {
  const result = await helix(
    "/eventsub/subscriptions",
    await appAccessToken(),
    "POST",
    {
      type: "channel.chat.message",
      version: "1",
      condition: {
        broadcaster_user_id: broadcasterId,
        user_id: BOT_USER_ID,
      },
      transport: {
        method: "webhook",
        callback: PUBLIC_URL + "/eventsub",
        secret: EVENTSUB_SECRET,
      },
    },
  );

  return result.data[0]?.id;
}

// # Send chat as ButtFartsBot
async function send(broadcasterId, message) {
  try {
    await helix("/chat/messages", BOT_ACCESS_TOKEN, "POST", {
      broadcaster_id: broadcasterId,
      sender_id: BOT_USER_ID,
      message: message.slice(0, 500),
    });
  } catch (error) {
    if (!BOT_REFRESH_TOKEN) throw error;

    const refreshed = await token({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: BOT_REFRESH_TOKEN,
    });

    BOT_ACCESS_TOKEN = refreshed.access_token;
    BOT_REFRESH_TOKEN = refreshed.refresh_token || BOT_REFRESH_TOKEN;

    await helix("/chat/messages", BOT_ACCESS_TOKEN, "POST", {
      broadcaster_id: broadcasterId,
      sender_id: BOT_USER_ID,
      message: message.slice(0, 500),
    });
  }
}

// # Letter replacement modes
function transformLetters(text, from, to) {
  return text.split(/(\s+)/).map((part) => {
    if (/^https?:\/\//i.test(part) || /^@/.test(part)) return part;

    return part.replace(new RegExp(from, "gi"), (letter) => {
      if (Math.random() >= LETTER_SWAP_CHANCE) return letter;
      return letter === letter.toUpperCase()
        ? to.toUpperCase()
        : to.toLowerCase();
    });
  }).join("");
}

// # Pick one active transformation
function transform(text, configuredModes) {
  const modes = cleanModes(configuredModes);
  const mode = modes.length
    ? modes[Math.floor(Math.random() * modes.length)]
    : "butt";

  if (mode === "r_to_w") {
    const result = transformLetters(text, "r", "w");
    return { result, isValid: result !== text };
  }

  if (mode === "c_to_k") {
    const result = transformLetters(text, "c", "k");
    return { result, isValid: result !== text };
  }

  const result = buttify(text, mode);
  return { result, isValid: valid(text, result, mode) };
}

function randomResponse(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

// # Page helpers
function page(body, title = "ButtFartsBot") {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: linear-gradient(145deg,#9fd7f2,#b6b4e8,#f5a7d2,#ff8fc4); color: #58271e; min-height: 100vh; }
    .wrap { width: min(1040px, calc(100% - 30px)); margin: auto; padding: 36px 0 54px; }
    .card { background: #fff8fcde; border: 4px solid white; border-radius: 30px; padding: 32px; }
    .modes, .frequencies { display: grid; gap: 13px; }
    .modes { grid-template-columns: repeat(4, 1fr); }
    .frequencies { grid-template-columns: repeat(3, 1fr); margin-top: 24px; }
    button, .cta { text-align: center; border-radius: 20px; border: 3px solid white; padding: 16px; font-weight: 800; cursor: pointer; }
    .selected { background: #d9d5df; color: #8d8791; }
    .cta { display: block; background: #ff987e; color: white; text-decoration: none; margin-bottom: 24px; }
  </style>
</head>
<body><main class="wrap">${body}</main></body>
</html>`;
}

function modeSelector(selectedModes) {
  const buttons = MODES.map(({ id, label, sample }) => `
    <button type="button" data-mode="${id}" class="${selectedModes.includes(id) ? "selected" : ""}">
      <strong>${label}</strong><br><small>${sample}</small>
    </button>
  `).join("");

  return `<div class="modes">${buttons}</div>`;
}

function frequencySelector(selectedFrequency) {
  return `<div class="frequencies">${FREQUENCIES.map(({ id, label, sample }) => `
    <button type="button" data-frequency="${id}" class="${selectedFrequency === id ? "selected" : ""}">
      <strong>${label}</strong><br><small>${sample}</small>
    </button>
  `).join("")}</div>`;
}

function settingsScript(active, selectedModes, selectedFrequency) {
  return `<script>
  (() => {
    const modeButtons = [...document.querySelectorAll('[data-mode]')];
    const frequencyButtons = [...document.querySelectorAll('[data-frequency]')];
    const cta = document.getElementById('settings-cta');
    let modes = ${JSON.stringify(selectedModes)};
    let frequency = ${JSON.stringify(selectedFrequency)};

    function render() {
      modeButtons.forEach((button) => {
        button.classList.toggle('selected', modes.includes(button.dataset.mode));
      });

      frequencyButtons.forEach((button) => {
        button.classList.toggle('selected', frequency === button.dataset.frequency);
      });

      const params = new URLSearchParams({ modes: modes.join(','), frequency });
      cta.href = (${active ? "true" : "false"} ? '/save-settings?' : '/select?') + params;
      const defaults = modes.length === 1 && modes[0] === 'butt' && frequency === 'good_amount';
      cta.textContent = ${active ? "'SAVE MY SETTINGS!'" : "defaults ? 'JUST ADD BUTTFARTSBOT!' : 'ADD MY SETTINGS!'"};
    }

    modeButtons.forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.mode;
      if (modes.includes(id)) {
        if (modes.length > 1) modes = modes.filter((mode) => mode !== id);
      } else {
        modes.push(id);
      }
      render();
    }));

    frequencyButtons.forEach((button) => button.addEventListener('click', () => {
      frequency = button.dataset.frequency;
      render();
    }));

    render();
  })();
  </script>`;
}

function home(userId = null) {
  const active = Boolean(userId && channels[userId]);
  const selectedModes = active ? channelModes(userId) : ["butt"];
  const selectedFrequency = active ? currentFrequency(userId) : "good_amount";

  return page(`
    <section class="card">
      <h1>ButtFartsBot</h1>
      <a class="cta" id="settings-cta" href="#">${active ? "SAVE MY SETTINGS!" : "JUST ADD BUTTFARTSBOT!"}</a>
      ${modeSelector(selectedModes)}
      ${frequencySelector(selectedFrequency)}
      ${active ? '<p><a href="/remove">Remove ButtFartsBot</a></p>' : '<p><a href="/manage">Already have it? Manage it</a></p>'}
    </section>
    ${settingsScript(active, selectedModes, selectedFrequency)}
  `);
}

// # Express routes
const app = express();

app.get("/", (_, response) => response.send(home()));
app.get("/manage", (_, response) => response.redirect(authUrl("manage")));
app.get("/remove", (_, response) => response.redirect(authUrl("remove")));

app.get("/select", (request, response) => {
  const selectedModes = cleanModes(request.query.modes || "butt");
  const selectedFrequency = String(request.query.frequency || "good_amount").toLowerCase();

  if (!selectedModes.length || !FREQUENCY_IDS.includes(selectedFrequency)) {
    return response.status(400).send("Invalid settings");
  }

  response.redirect(authUrl("select", { selectedModes, selectedFrequency }));
});

app.get("/save-settings", (request, response) => {
  const selectedModes = cleanModes(request.query.modes);
  const selectedFrequency = String(request.query.frequency || "").toLowerCase();

  if (!selectedModes.length || !FREQUENCY_IDS.includes(selectedFrequency)) {
    return response.status(400).send("Invalid settings");
  }

  response.redirect(authUrl("save", { selectedModes, selectedFrequency }));
});

// # Broadcaster OAuth callback
app.get("/auth/callback", async (request, response) => {
  try {
    if (request.query.error) throw Error(request.query.error_description || request.query.error);

    const state = readState(request.query.state);
    const authToken = await token({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      code: request.query.code,
      grant_type: "authorization_code",
      redirect_uri: PUBLIC_URL + "/auth/callback",
    });

    const user = (await helix("/users", authToken.access_token)).data[0];

    if (state.mode === "select") {
      if (!channels[user.id]) {
        channels[user.id] = {
          login: user.login,
          name: user.display_name,
          sub: await addSubscription(user.id),
          modes: cleanModes(state.selectedModes).length ? cleanModes(state.selectedModes) : ["butt"],
          frequency: FREQUENCY_IDS.includes(state.selectedFrequency) ? state.selectedFrequency : "good_amount",
          opted_out_users: [],
        };
      }
      return response.send(home(user.id));
    }

    if (state.mode === "save") {
      if (!channels[user.id]) return response.send(home());
      channels[user.id].modes = cleanModes(state.selectedModes);
      channels[user.id].frequency = FREQUENCY_IDS.includes(state.selectedFrequency)
        ? state.selectedFrequency
        : currentFrequency(user.id);
      return response.send(home(user.id));
    }

    if (state.mode === "manage") {
      return response.send(channels[user.id] ? home(user.id) : home());
    }

    if (state.mode === "remove") {
      delete channels[user.id];
      return response.send(home());
    }

    response.send(home());
  } catch (error) {
    console.error(error);
    response.status(500).send("Setup failed");
  }
});

// # Twitch EventSub webhook
app.post("/eventsub", express.raw({ type: "application/json" }), async (request, response) => {
  const messageId = request.get("Twitch-Eventsub-Message-Id") || "";
  const timestamp = request.get("Twitch-Eventsub-Message-Timestamp") || "";
  const suppliedSignature = request.get("Twitch-Eventsub-Message-Signature") || "";

  const expectedSignature = "sha256=" + crypto
    .createHmac("sha256", EVENTSUB_SECRET)
    .update(messageId + timestamp + request.body)
    .digest("hex");

  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);

  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return response.sendStatus(403);
  }

  const payload = JSON.parse(request.body);
  const messageType = request.get("Twitch-Eventsub-Message-Type");

  if (messageType === "webhook_callback_verification") {
    return response.send(payload.challenge);
  }

  response.sendStatus(204);
  if (messageType !== "notification") return;

  const event = payload.event;
  const text = event?.message?.text || "";
  const channel = channels[event.broadcaster_user_id];

  if (!channel || event.chatter_user_id === BOT_USER_ID) return;

  // # !notme and !pickme
  if (/^!notme\b/i.test(text.trim())) {
    const chatterId = String(event.chatter_user_id);
    if (!channel.opted_out_users.includes(chatterId)) {
      channel.opted_out_users.push(chatterId);
      await send(event.broadcaster_user_id, `@${event.chatter_user_name} got it, I won't mess with your messages.`);
    }
    return;
  }

  if (/^!pickme\b/i.test(text.trim())) {
    const chatterId = String(event.chatter_user_id);
    channel.opted_out_users = channel.opted_out_users.filter((id) => id !== chatterId);
    await send(event.broadcaster_user_id, `@${event.chatter_user_name} welcome back. Your messages are fair game again.`);
    return;
  }

  // # Canned responses
  const goodBot = /\bgood\s+bot\b/i.test(text);
  const mentioned = /\bbuttfartsbot\b/i.test(text);

  if (goodBot || mentioned) {
    const lastReply = cannedCooldowns.get(event.broadcaster_user_id) || 0;

    if (Date.now() - lastReply >= CANNED_COOLDOWN_MS) {
      cannedCooldowns.set(event.broadcaster_user_id, Date.now());
      await send(
        event.broadcaster_user_id,
        randomResponse(goodBot ? GOOD_BOT_RESPONSES : MENTION_RESPONSES),
      );
    }
    return;
  }

  // # Normal ButtFartsBot activation
  if (optedOut(channel, event.chatter_user_id)) return;
  if (text.startsWith("!")) return;
  if (Math.floor(Math.random() * frequencyRate(event.broadcaster_user_id))) return;

  const { result, isValid } = transform(text, channelModes(event.broadcaster_user_id));
  if (isValid) await send(event.broadcaster_user_id, result);
});

app.get("/health", (_, response) => response.sendStatus(200));
app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("ButtFartsBot showcase server is ready");
});
