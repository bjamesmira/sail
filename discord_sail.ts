//  Run with: deno run --allow-net discord_sail.ts
//  Host: 127.0.0.1, Port: 43383
//  Go to https://discord.com/developers/applications and click New Application. Name it whatever, mine's Deckhand.
//  Go to the Bot tab > click Add Bot > confirm.
//  Under Token, click Reset Token and copy it. Save it somewhere safe — you'll only see it once.
//  Scroll down on the Bot tab and enable Message Content Intent (required for reading chat messages). Also enable Manage Messages if you want it to remove reactions and clean up.
//  Go to OAuth2 > URL Generator. Check bot, then under bot permissions check Read Messages/View Channels and Send Messages.
//  Copy the generated URL, paste it in your browser, and invite the bot to your Discord server.
//  In Discord, go to the channel you want to use for commands, right-click it > Copy Channel ID (you need Developer Mode on in Discord settings for this).

import { Sail } from "./Sail.ts";
import { SohClient } from "./SohClient.ts";

const DISCORD_TOKEN = "(Discord bot token here)";
const CHANNEL_ID = "(Discord channel ID it's receiving input from)";
const COOLDOWN_MS = 15 * 1000; // Timer for how long until someone can use a command again. 15 seconds per user

const DELETE_FLAVOR_MS  = 20 * 1000; // Timer for when it will delete the flavor text. 20 seconds.
const DELETE_SYSTEM_MS  = 5 * 1000; // Timer for when it will delete cooldown/error messages.

let sohClient: SohClient | undefined;

const cooldowns = new Map<string, number>();

function isOnCooldown(userId: string): number {
    const last = cooldowns.get(userId);
    if (!last) return 0;
    const remaining = COOLDOWN_MS - (Date.now() - last);
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

const sail = new Sail({ port: 43383, debug: false });

sail.on("clientConnected", (client) => {
    console.log("✅ SoH connected!");
    sohClient = client;
    client.on("disconnected", () => {
    console.log("⚠️ SoH disconnected.");
    sohClient = undefined;
    });
});

function uid() {
    return Math.random().toString(36).slice(2);
}

function rng(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function deleteMessage(messageId: string) {
    await discordRequest("DELETE", `/channels/${CHANNEL_ID}/messages/${messageId}`);
}

async function sendDiscordMessage(content: string, delayMs = DELETE_FLAVOR_MS) {
    const msg = await discordRequest("POST", `/channels/${CHANNEL_ID}/messages`, { content });
    if (msg?.id) {
        setTimeout(() => deleteMessage(msg.id), delayMs);
    }
    return msg;
}

function timedEffect(applyEffect: object, removeEffect: object, startMsg: string, endMsg: string, onEnd?: () => void) {
    const seconds = rng(20, 60);
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: applyEffect } as any);
    sendDiscordMessage(startMsg);
    console.log(`[Sail] Timed effect expires in ${seconds}s`);
    setTimeout(() => {
        sohClient?.sendPacket({ id: uid(), type: "effect", effect: removeEffect } as any);
        sendDiscordMessage(endMsg);
        onEnd?.();
    }, seconds * 1000);
}

const COMMAND_FLAVOR: Record<string, (username: string) => string> = {
  "loseheart":  (u) => `**${u}** pierced the bow!`,
  "gainheart":  (u) => `**${u}** tossed us a bottle of rum.`,
  "fullhp":     (u) => `**${u}** patched up the whole ship!`,
  "oneheart":   (u) => `**${u}** made a pact with Davy Jones...`,
  "freeze":     (u) => `**${u}** sailed us straight into an iceberg.`,
  "yeet":       (u) => `**${u}** says "Walk the plank!"`,
  "burn":       (u) => `**${u}** set the ship ablaze!`,
  "zap":        (u) => `**${u}** found an electric eel in the bilge!`,
  "cuccos":     (u) => `Did **${u}** fuck a cucco?`,
  "tp":         (u) => `**${u}** got us sucked into a whirlpool!`,
  "poorboy":    (u) => `**${u}** raided our treasure chest!`,
  "rich":       (u) => `**${u}** dropped a chest of gold on our lap!`,
  "noreverse":  (u) => `**${u}** got the compass working again!`,
  "ui":         (u) => `**${u}** fished the charts back out of the sea!`,
  "nohko":      (u) => `**${u}** threw James some proper armor!`,
  "nobonks":    (u) => `**${u}** cleared the cannonballs off the deck!`,
  "nowind":     (u) => `**${u}** calmed the seas for James!`,
  "nopacifist": (u) => ` **${u}** handed James his cutlass back!`,
  "link":       (u) => `**${u}** called off the mutiny! Everything resets!`,
};

const TIMED_FLAVOR: Record<string, { start: (username: string) => string; end: string }> = {
  "lowgrav":  {
    start: (u) => `**${u}** is cutting through the waves!`,
    end:         `We crashed back down to the deck.`,
  },
  "highgrav": {
    start: (u) => `**${u}** dropped anchor!`,
    end:         `Anchor's up!`,
  },
  "reverse":  {
    start: (u) => `**${u}** backed the sails!`,
    end:         `The sails have flipped back.`,
  },
  "pacifist": {
    start: (u) => `**${u}** struck the colors!`,
    end:         `What're you doing?! Hoist those colors! Stat!`,
  },
  "noui":     {
    start: (u) => `**${u}** threw the charts and compass overboard!`,
    end:         `We fished them back up.`,
  },
  "ohko":     {
    start: (u) => `**${u}** has unleashed the Kracken!`,
    end:         `The Kracken retreated back to the deep.`,
  },
  "bonks":    {
    start: (u) => `**${u}** loaded the cannons — aimed right at James!`,
    end:         `The cannons finally ran out of powder.`,
  },
  "wind":     {
    start: (u) => `**${u}** is steering us against the trade winds!`,
    end:         `The winds finally died down.`,
  },
};

const COMMANDS: Record<string, (username: string, args: string[], onEnd?: () => void) => void> = {

  "loseheart":  () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "ModifyHealth",      parameters: [-1]  } }),
  "gainheart":  () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "ModifyHealth",      parameters: [1]   } }),
  "fullhp":     () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "SetPlayerHealth",   parameters: [20]  } }),
  "oneheart":   () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "SetPlayerHealth",   parameters: [1]   } }),

  "lowgrav":    (u, _, onEnd) => { const f = TIMED_FLAVOR["lowgrav"];  timedEffect({ type: "apply", name: "ModifyGravity", parameters: [0] }, { type: "apply", name: "ModifyGravity", parameters: [1] }, f.start(u), f.end, onEnd); },
  "highgrav":   (u, _, onEnd) => { const f = TIMED_FLAVOR["highgrav"]; timedEffect({ type: "apply", name: "ModifyGravity", parameters: [2] }, { type: "apply", name: "ModifyGravity", parameters: [1] }, f.start(u), f.end, onEnd); },

  "reverse":    (u, _, onEnd) => { const f = TIMED_FLAVOR["reverse"];   timedEffect({ type: "apply",  name: "ReverseControls"  }, { type: "remove", name: "ReverseControls"  }, f.start(u), f.end, onEnd); },
  "pacifist":   (u, _, onEnd) => { const f = TIMED_FLAVOR["pacifist"];  timedEffect({ type: "apply",  name: "PacifistMode"     }, { type: "remove", name: "PacifistMode"     }, f.start(u), f.end, onEnd); },
  "noui":       (u, _, onEnd) => { const f = TIMED_FLAVOR["noui"];      timedEffect({ type: "apply",  name: "NoUI"             }, { type: "remove", name: "NoUI"             }, f.start(u), f.end, onEnd); },
  "ohko":       (u, _, onEnd) => { const f = TIMED_FLAVOR["ohko"];      timedEffect({ type: "apply",  name: "OneHitKO"         }, { type: "remove", name: "OneHitKO"         }, f.start(u), f.end, onEnd); },
  "bonks":      (u, _, onEnd) => { const f = TIMED_FLAVOR["bonks"];     timedEffect({ type: "apply",  name: "RandomBonks"      }, { type: "remove", name: "RandomBonks"      }, f.start(u), f.end, onEnd); },
  "wind":       (u, _, onEnd) => { const f = TIMED_FLAVOR["wind"];      timedEffect({ type: "apply",  name: "RandomWind"       }, { type: "remove", name: "RandomWind"       }, f.start(u), f.end, onEnd); },
  "tp": (username, args) => {
    const value = rng(1, 1500);
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply", name: "TeleportPlayer", parameters: [value] } });
  },

  "yeet":       () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "KnockbackPlayer",   parameters: [2] } }),
  "noreverse":  () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "ReverseControls"   } }),
  "ui":         () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "NoUI"              } }),
  "nohko":      () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "OneHitKO"          } }),
  "nobonks":    () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "RandomBonks"       } }),
  "nowind":     () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "RandomWind"        } }),
  "nopacifist": () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "PacifistMode"      } }),

  "burn":       () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "BurnPlayer"         } }),
  "zap":        () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "ElectrocutePlayer"  } }),
  "freeze":     () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "FreezePlayer"       } }),
  "cuccos":     () => sohClient?.sendPacket({ id: uid(), type: "command", command: "cucco_storm" }),

  "poorboy":    () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "ModifyRupees",  parameters: [-999] } }),
  "rich":       () => sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "ModifyRupees",  parameters: [999]  } }),
  "gamble":     (username) => {
    const amount = rng(1, 100);
    const win = Math.random() < 0.5;
    if (win) {
      sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply", name: "ModifyRupees", parameters: [amount] } });
      sendDiscordMessage(`🎲 **${username}** gambled and James **won ${amount} rupees**! 🤑`);
    } else {
      sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply", name: "ModifyRupees", parameters: [-amount] } });
      sendDiscordMessage(`🎲 **${username}** gambled and James **lost ${amount} rupees**! 💸`);
    }
  },

  "link": () => {
	sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply", name: "ModifyRunSpeedModifier", parameters: [1] } });
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "FreezePlayer"       } });
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "ReverseControls"    } });
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "DisableZTargeting"  } });
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "NoUI"               } });
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "OneHitKO"           } });
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "RandomBonks"        } });
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "RandomWind"         } });
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "remove", name: "PacifistMode"       } });
    sohClient?.sendPacket({ id: uid(), type: "effect", effect: { type: "apply",  name: "ModifyGravity",     parameters: [1] } });
  },
};

const TIMED_COMMANDS = new Set([
  "lowgrav", "highgrav", "reverse", "pacifist",
  "noui", "ohko", "bonks", "wind",
]);

const REACTION_MAP: Record<string, string> = {
  "💔": "loseheart",
  "💖": "gainheart",
  "📵": "noui",
  "🧊": "freeze",
  "🔥": "burn",
  "⚡": "zap",
  "👋": "yeet",
  "💀": "ohko",
  "🔀": "reverse",
  "☮️": "pacifist",
  "🪶": "lowgrav",
  "🏋️": "highgrav",
  "🎲": "gamble",
  "💨": "wind",
  "🐔": "cuccos",
  "🗺️": "tp",
  "🆘": "link",
};

const PANEL_TEXT =
`**Ocarina of Time - Buddy System**
💔 lose heart  |  💖 gain heart  |  📵 no HUD
🧊 freeze  |  🔥 burn  |  ⚡ zap
👋 yeet  |  💀 one hit KO
🔀 reverse controls  |  ☮️ pacifist
🪶 low gravity  |  🏋️ high gravity
🎲 gamble rupees  | 💨 blow me down
🐔 iykyk | 🗺️ teleport | 🆘 stop chaos
**15 second cooldown per person after each use**`;

let panelMessageId: string | null = null;

async function discordRequest(method: string, path: string, body?: object) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status !== 204) {
    try { return await res.json(); } catch { return null; }
  }
  return null;
}

async function postPanel() {
  console.log("[Panel] Posting reaction control panel...");
  const msg = await discordRequest("POST", `/channels/${CHANNEL_ID}/messages`, { content: PANEL_TEXT });
  if (!msg?.id) {
    console.error("[Panel] Failed to post panel message.");
    return;
  }
  panelMessageId = msg.id;
  console.log(`[Panel] Panel posted (message ID: ${panelMessageId}). Adding reactions...`);
  for (const emoji of Object.keys(REACTION_MAP)) {
    await discordRequest("PUT", `/channels/${CHANNEL_ID}/messages/${panelMessageId}/reactions/${encodeURIComponent(emoji)}/@me`);
    await new Promise(r => setTimeout(r, 350));
  }
  console.log("[Panel] All reactions added. Panel is live!");
}

async function addReaction(messageId: string, emoji: string) {
  await discordRequest("PUT", `/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
}

async function removeUserReaction(messageId: string, emoji: string, userId: string) {
  await discordRequest("DELETE", `/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/${userId}`);
}

function connectDiscord() {
  console.log("[Discord] Connecting...");
  const ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
  let heartbeatInterval: number | undefined;
  let lastSeq: number | null = null;

  ws.onopen = () => console.log("[Discord] Connected to gateway.");

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.s !== null) lastSeq = data.s;

    switch (data.op) {
      case 10:
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
          ws.send(JSON.stringify({ op: 1, d: lastSeq }));
        }, data.d.heartbeat_interval);
        ws.send(JSON.stringify({
          op: 2,
          d: {
            token: DISCORD_TOKEN,
            intents: (1 << 0) | (1 << 9) | (1 << 10) | (1 << 15),
            properties: { os: "windows", browser: "deno", device: "deno" },
          },
        }));
        break;

      case 0:
        if (data.t === "READY") {
          console.log(`[Discord] Logged in as ${data.d.user.username}.`);
          postPanel();
        }
        if (data.t === "MESSAGE_CREATE")       handleMessage(data.d);
        if (data.t === "MESSAGE_REACTION_ADD") handleReaction(data.d);
        break;

      case 9:
        console.error("[Discord] Invalid session — check your token and intents.");
        break;
    }
  };

  ws.onclose = (e) => {
    console.warn(`[Discord] Disconnected (${e.code}). Reconnecting in 5s...`);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    setTimeout(connectDiscord, 5000);
  };

  ws.onerror = (e) => console.error("[Discord] Error:", e);
}

async function handleReaction(event: {
  message_id: string;
  channel_id: string;
  user_id: string;
  member?: { user?: { username?: string; bot?: boolean } };
  emoji: { name: string };
}) {
  if (event.message_id !== panelMessageId) return;
  if (event.channel_id !== CHANNEL_ID) return;
  if (event.member?.user?.bot) return;

  const emoji = event.emoji.name;
  const username = event.member?.user?.username ?? "Someone";
  const cmdName = REACTION_MAP[emoji];
  if (!cmdName) return;

  if (!sohClient) {
    await removeUserReaction(event.message_id, emoji, event.user_id);
    sendDiscordMessage(`Give me a fuckin minute, the game's not connected.`, DELETE_SYSTEM_MS);
    return;
  }

  const remainingSecs = isOnCooldown(event.user_id);
  if (remainingSecs > 0) {
    await removeUserReaction(event.message_id, emoji, event.user_id);
    sendDiscordMessage(`**${username}**, you're on cooldown for **${remainingSecs}s**. Chill.`, DELETE_SYSTEM_MS);
    return;
  }
  cooldowns.set(event.user_id, Date.now());

  const handler = COMMANDS[cmdName];
  if (!handler) return;

  if (TIMED_COMMANDS.has(cmdName)) {
    handler(username, [], () => removeUserReaction(event.message_id, emoji, event.user_id));
  } else {
    await removeUserReaction(event.message_id, emoji, event.user_id);
    handler(username, []);
    const flavor = COMMAND_FLAVOR[cmdName];
    if (flavor) sendDiscordMessage(flavor(username));
  }

  console.log(`[Discord] ${username} reacted ${emoji} → !${cmdName}`);
}

function handleMessage(msg: {
  channel_id: string;
  author: { bot?: boolean; username: string; id: string };
  content: string;
}) {
  if (msg.author?.bot) return;
  if (msg.channel_id !== CHANNEL_ID) return;

  const parts = msg.content.trim().toLowerCase().split(/\s+/);
  if (!parts[0].startsWith("!")) return;

  const cmd = parts[0].slice(1);
  const args = parts.slice(1);

  if (cmd === "help") {
    sendDiscordMessage(PANEL_TEXT);
    return;
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    console.log(`[Discord] Unknown command: !${cmd}`);
    return;
  }

  if (!sohClient) {
    sendDiscordMessage(`Give me a fuckin minute, the game's not connected.`, DELETE_SYSTEM_MS);
    return;
  }

  const remainingSecs = isOnCooldown(msg.author.id);
  if (remainingSecs > 0) {
    sendDiscordMessage(`**${msg.author.username}** you're on cooldown for **${remainingSecs}s**. Chill.`, DELETE_SYSTEM_MS);
    return;
  }
  cooldowns.set(msg.author.id, Date.now());

  handler(msg.author.username, args);
  console.log(`[Discord] ${msg.author.username} fired: !${cmd}`);

  if (!TIMED_COMMANDS.has(cmd)) {
    const flavor = COMMAND_FLAVOR[cmd];
    if (flavor) sendDiscordMessage(flavor(msg.author.username));
  }
}

console.log("==============================================");
console.log("  SoH Discord Sail Bridge — Starting up...");
console.log("==============================================");

sail.start();
connectDiscord();
