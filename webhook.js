import express from 'express';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUBSCRIBERS_FILE = path.join(__dirname, 'subscribers.json');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Хранилище отслеживаемых элементов {id: stageId}
const trackedItems = new Map();

// --- Управление подписчиками ---

function loadSubscribers() {
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading subscribers:', e.message);
  }
  return [];
}

function saveSubscribers(list) {
  try {
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(list), 'utf8');
  } catch (e) {
    console.error('Error saving subscribers:', e.message);
  }
}

function addSubscriber(chatId) {
  const list = loadSubscribers();
  if (!list.includes(chatId)) {
    list.push(chatId);
    saveSubscribers(list);
    console.log(`➕ Subscriber added: ${chatId}`);
  }
}

function removeSubscriber(chatId) {
  const list = loadSubscribers().filter(id => id !== chatId);
  saveSubscribers(list);
  console.log(`➖ Subscriber removed: ${chatId}`);
}

// Инициализация: добавляем дефолтного подписчика из .env
if (process.env.TELEGRAM_CHAT_ID) {
  addSubscriber(Number(process.env.TELEGRAM_CHAT_ID));
}

// --- Telegram long polling ---

let telegramOffset = 0;

async function pollTelegramUpdates() {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getUpdates?offset=${telegramOffset}&timeout=1`
    );
    const data = await response.json();

    if (data.result && data.result.length > 0) {
      for (const update of data.result) {
        telegramOffset = update.update_id + 1;
        const msg = update.message;
        if (!msg) continue;

        const chatId = msg.chat.id;
        const text = msg.text || '';

        if (text.startsWith('/start')) {
          addSubscriber(chatId);
          await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '✅ Вы подписаны на уведомления. Для отписки отправьте /stop' }),
          });
        } else if (text.startsWith('/stop')) {
          removeSubscriber(chatId);
          await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '🔕 Вы отписаны от уведомлений.' }),
          });
        }
      }
    }
  } catch (e) {
    console.error('Telegram polling error:', e.message);
  }
}

setInterval(pollTelegramUpdates, 2000);

// --- Отправка уведомлений ---

async function sendTelegramMessage(itemId, title, assignedBy, stageId) {
  const itemUrl = `${process.env.PORTAL_URL}/crm/type/${process.env.ENTITY_TYPE_ID}/details/${itemId}/`;
  const text = `✅ Элемент перешёл в целевую стадию\n📋 ${title}\n👤 Ответственный: ${assignedBy}\n🔗 ${itemUrl}`;

  const subscribers = loadSubscribers();
  console.log(`📤 Sending to ${subscribers.length} subscribers...`);

  for (const chatId of subscribers) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`Telegram error for ${chatId}:`, err);
      } else {
        console.log(`✅ Sent to ${chatId} for item ${itemId}`);
      }
    } catch (e) {
      console.error(`Fetch error for ${chatId}:`, e.message);
    }
  }
}

// --- Polling смарт-процесса ---

async function checkStageChanges() {
  try {
    const url = `${process.env.BITRIX_WEBHOOK_URL}crm.item.list?entityTypeId=${process.env.ENTITY_TYPE_ID}&order[ID]=DESC&select[]=id&select[]=title&select[]=stageId&select[]=assignedById`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.result && data.result.items) {
      const items = data.result.items;
      console.log(`🔍 Checking ${items.length} items...`);

      for (const item of items) {
        const itemId = item.id;
        const currentStage = item.stageId;
        const previousStage = trackedItems.get(itemId);

        console.log(`   Item ${itemId}: ${previousStage || 'NEW'} → ${currentStage}`);

        if (currentStage === process.env.TARGET_STAGE_ID && previousStage !== currentStage) {
          console.log(`🎯 Stage change detected: item ${itemId} → ${currentStage}`);

          await sendTelegramMessage(
            itemId,
            item.title || 'Без названия',
            item.assignedById || 'Неизвестно',
            currentStage
          );
        }

        trackedItems.set(itemId, currentStage);
      }
    }
  } catch (e) {
    console.error('Polling error:', e.message);
  }
}

setInterval(checkStageChanges, 60000);

(async () => {
  try {
    const url = `${process.env.BITRIX_WEBHOOK_URL}crm.item.list?entityTypeId=${process.env.ENTITY_TYPE_ID}&order[ID]=DESC&select[]=id&select[]=stageId`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.result && data.result.items) {
      data.result.items.forEach(item => {
        trackedItems.set(item.id, item.stageId);
      });
      console.log(`🔄 Initialized tracking for ${trackedItems.size} items`);
    }
  } catch (e) {
    console.error('Init error:', e.message);
  }

  checkStageChanges();
})();

// Healthcheck endpoint
app.get('/', (req, res) => res.send('OK'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Polling smart process stages on port ${port}`));
