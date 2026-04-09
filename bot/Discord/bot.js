// Discord/bot.js
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { parseRequest, checkAvailabilityList } = require('../Scraper/scraper');

const DISCORD_TOKEN    = process.env.DISCORD_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`Bot起動: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Bot自身のメッセージは無視
  if (message.author.bot) return;

  // 専用チャンネル以外は無視
  if (message.channelId !== TARGET_CHANNEL_ID) return;

  // 各行をパース（書式に合わない行は無視）
  const lines = message.content.split('\n');
  const requests = lines
    .map(line => {
      const parsed = parseRequest(line);
      if (!parsed) return null;
      return { ...parsed, originalLine: line.trim() };
    })
    .filter(Boolean);

  // 書式に合う行が1件もなければ無視
  if (requests.length === 0) return;

  await message.reply(`🔍 ${requests.length}件チェックします...`);

  // 1件ずつ処理してリアルタイムに送信
  await checkAvailabilityList(requests, async (originalLine, date, checkTime, result) => {
    const label = `**${date} ${checkTime.start}-${checkTime.end}**`;

    let text;
    if (result.error) {
      text = `${label}\n❌ エラー: ${result.error}`;

    } else if (result.status === 'Open') {
      text = `${label}\n✅ Open`;

    } else if (result.allOccupied) {
      text = `${label}\n🔴 ${result.message}`;

    } else {
      const slots = result.freeSlots.join(', ');
      text = `${label}\n🔴 予約済み\n空き時間: ${slots}`;
    }

    await message.channel.send(text);
  });
});

client.login(DISCORD_TOKEN);
const http = require('http');
const PORT = process.env.PORT || 4000;
http.createServer((req, res) => res.end('ok')).listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});