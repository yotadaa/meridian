/**
 * Communication-only setup wizard.
 * Run: npm run setup:communication
 */

import "../envcrypt.js";
import readline from "readline";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "user-config.json");
const ENV_PATH = path.join(ROOT, ".env");
const WHATSAPP_SESSION_DIR = path.join(ROOT, ".wwebjs_auth", "session-meridian");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultVal) {
  return new Promise((resolve) => {
    const hint = defaultVal !== undefined && defaultVal !== "" ? ` (default: ${defaultVal})` : "";
    rl.question(`${question}${hint}: `, (ans) => {
      const trimmed = ans.trim();
      resolve(trimmed === "" ? defaultVal : trimmed);
    });
  });
}

async function askBool(question, defaultVal) {
  while (true) {
    const hint = defaultVal ? "Y/n" : "y/N";
    const raw = await ask(`${question} [${hint}]`, "");
    if (raw === "") return defaultVal;
    if (/^y(es)?$/i.test(raw)) return true;
    if (/^n(o)?$/i.test(raw)) return false;
    console.log("  ⚠ Enter y or n.");
  }
}

async function askChoice(question, choices) {
  const labels = choices.map((c, i) => `  ${i + 1}. ${c.label}`).join("\n");
  while (true) {
    console.log(`\n${question}`);
    console.log(labels);
    const raw = await ask("Enter number", "");
    const idx = parseInt(raw) - 1;
    if (idx >= 0 && idx < choices.length) return choices[idx];
    console.log("  ⚠ Invalid choice.");
  }
}

function parseEnv(content) {
  const map = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) map[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return map;
}

function buildEnv(map) {
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

function readConfig() {
  try { return fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) : {}; }
  catch { return {}; }
}

function readEnv() {
  return fs.existsSync(ENV_PATH) ? parseEnv(fs.readFileSync(ENV_PATH, "utf8")) : {};
}

async function bindWhatsAppQr() {
  console.log("\nStarting WhatsApp QR binding. Scan the QR code with WhatsApp Linked Devices.");
  const [whatsappWeb, qrcode] = await Promise.all([
    import("whatsapp-web.js"),
    import("qrcode-terminal"),
  ]);
  const { Client, LocalAuth } = whatsappWeb.default || whatsappWeb;
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: "meridian" }),
    puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WhatsApp QR binding timed out after 2 minutes")), 120000);
    client.on("qr", (qr) => qrcode.default.generate(qr, { small: true }));
    client.on("ready", async () => {
      clearTimeout(timer);
      console.log("  ✓ WhatsApp session ready.");
      await client.destroy();
      resolve();
    });
    client.on("auth_failure", (message) => { clearTimeout(timer); reject(new Error(message)); });
    client.initialize().catch((error) => { clearTimeout(timer); reject(error); });
  });
}

console.log(`
╔═══════════════════════════════════════════════╗
║        Meridian — Communication Setup         ║
╚═══════════════════════════════════════════════╝
`);

const existingConfig = readConfig();
const existingEnv = readEnv();
const alreadySet = (val) => val ? "*** (already set — Enter to keep)" : "";

const channelChoice = await askChoice("Preferred Channel:", [
  { label: "Telegram", key: "telegram" },
  { label: "WhatsApp", key: "whatsapp" },
]);
const preferredChannel = channelChoice.key;

let telegramToken = existingEnv.TELEGRAM_BOT_TOKEN || "";
let telegramChatId = existingEnv.TELEGRAM_CHAT_ID || existingConfig.telegramChatId || "";
let whatsappChatId = existingEnv.WHATSAPP_CHAT_ID || existingConfig.whatsappChatId || "";

if (preferredChannel === "telegram") {
  console.log("\n── Telegram ─────────────────────────────────────────────────");
  const tokenRaw = await ask("Telegram bot token", alreadySet(telegramToken));
  if (tokenRaw && !tokenRaw.startsWith("***")) telegramToken = tokenRaw;
  telegramChatId = await ask("Telegram chat ID", telegramChatId);
}

if (preferredChannel === "whatsapp") {
  console.log("\n── WhatsApp ─────────────────────────────────────────────────");
  if (fs.existsSync(WHATSAPP_SESSION_DIR)) {
    const updateSession = await askBool("Existing WhatsApp session found. Update/rebind it?", false);
    if (updateSession) {
      fs.rmSync(WHATSAPP_SESSION_DIR, { recursive: true, force: true });
      console.log("  Removed old WhatsApp session. A new QR code will be shown below.");
    } else {
      console.log("  Keeping existing WhatsApp session.");
    }
  }
  whatsappChatId = await ask("WhatsApp control chat ID (optional — press Enter to auto-link first inbound chat)", whatsappChatId);
  const shouldBind = !fs.existsSync(WHATSAPP_SESSION_DIR) || await askBool("Show WhatsApp QR code now?", true);
  if (shouldBind) {
    try {
      await bindWhatsAppQr();
    } catch (error) {
      console.log(`  ⚠ WhatsApp binding skipped/failed: ${error.message}`);
      console.log("  Run npm install if dependencies are missing, then retry npm run setup:communication.");
    }
  }
}

rl.close();

const envMap = {
  ...existingEnv,
  PREFERRED_CHANNEL: preferredChannel,
  ...(telegramToken ? { TELEGRAM_BOT_TOKEN: telegramToken } : {}),
  ...(telegramChatId ? { TELEGRAM_CHAT_ID: telegramChatId } : {}),
  ...(whatsappChatId ? { WHATSAPP_CHAT_ID: whatsappChatId } : {}),
};
fs.writeFileSync(ENV_PATH, buildEnv(envMap));

const userConfig = {
  ...existingConfig,
  preferredChannel,
  telegramChatId: telegramChatId || existingConfig.telegramChatId || "",
  whatsappChatId: whatsappChatId || existingConfig.whatsappChatId || "",
};
fs.writeFileSync(CONFIG_PATH, JSON.stringify(userConfig, null, 2));

console.log(`
╔═══════════════════════════════════════════════╗
║      Communication Setup Complete             ║
╚═══════════════════════════════════════════════╝

  Channel:      ${preferredChannel}
  Telegram:     ${telegramToken ? "configured" : "not configured"}
  WhatsApp:     ${preferredChannel === "whatsapp" ? "configured" : (whatsappChatId ? "configured" : "not configured")}
  .env:         ${ENV_PATH}
  Config:       ${CONFIG_PATH}
`);
