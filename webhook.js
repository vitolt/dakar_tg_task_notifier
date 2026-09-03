import express from 'express';
import 'dotenv/config';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Хранилище отслеживаемых элементов {id: stageId}
const trackedItems = new Map();

// Функция отправки в Telegram
async function sendTelegramMessage(itemId, title, assignedBy, stageId) {
  const itemUrl = `${process.env.PORTAL_URL}/crm/type/${process.env.ENTITY_TYPE_ID}/details/${itemId}/`;
  const text = `✅ Задача переведена в тестирование\n📋 ${title}\n🔗 ${itemUrl}`;

  try {
    const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Telegram error:', err);
    } else {
      console.log(`✅ Sent notification for item ${itemId} (stage: ${stageId})`);
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}

// Polling: проверка смены стадии элементов смарт-процесса
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

        // Если элемент перешёл в целевую стадию
        if (currentStage === process.env.TARGET_STAGE_ID && previousStage !== currentStage) {
          console.log(`🎯 Stage change detected: item ${itemId} → ${currentStage}`);

          await sendTelegramMessage(
            itemId,
            item.title || 'Без названия',
            item.assignedById || 'Неизвестно',
            currentStage
          );
        }

        // Обновляем состояние элемента
        trackedItems.set(itemId, currentStage);
      }
    }
  } catch (e) {
    console.error('Polling error:', e.message);
  }
}

// Запуск polling каждые 30 минут
setInterval(checkStageChanges, 10 * 60 * 1000);

// Первая проверка сразу при старте (инициализация trackedItems)
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

  // Запускаем первую проверку сразу
  checkStageChanges();
})();

// Healthcheck endpoint
app.get('/', (req, res) => res.send('OK'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Polling smart process stages on port ${port}`));
