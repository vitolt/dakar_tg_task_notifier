import express from 'express';
import 'dotenv/config';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Хранилище последнего проверенного ID задачи
let lastCheckedTaskId = 0;

// Функция отправки в Telegram
async function sendTelegramMessage(taskId, title, createdByName, responsibleId) {
  const taskUrl = `${process.env.PORTAL_URL}/company/personal/user/${responsibleId}/tasks/task/view/${taskId}/`;
  const text = `📋 Новая задача: ${title}\n👤 Постановщик: ${createdByName}\n🔗 ${taskUrl}`;

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
      console.log(`✅ Sent notification for task ${taskId}`);
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}

// Polling: проверка новых задач каждую минуту
async function checkNewTasks() {
  try {
    const url = `${process.env.BITRIX_WEBHOOK_URL}tasks.task.list?filter[RESPONSIBLE_ID]=${process.env.TARGET_BITRIX_USER_ID}&order[ID]=DESC&select[]=ID&select[]=TITLE&select[]=CREATED_BY_NAME&select[]=RESPONSIBLE_ID`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.result && data.result.tasks) {
      const tasks = data.result.tasks;

      for (const task of tasks) {
        const taskId = parseInt(task.id);

        // Пропускаем уже обработанные задачи
        if (taskId <= lastCheckedTaskId) break;

        console.log(`📌 New task found: ${taskId} - ${task.title}`);

        await sendTelegramMessage(
          taskId,
          task.title,
          task.createdByName || 'Неизвестно',
          task.responsibleId
        );
      }

      // Обновляем последний проверенный ID
      if (tasks.length > 0) {
        lastCheckedTaskId = Math.max(lastCheckedTaskId, parseInt(tasks[0].id));
      }
    }
  } catch (e) {
    console.error('Polling error:', e.message);
  }
}

// Запуск polling каждые 60 секунд
setInterval(checkNewTasks, 60000);

// Первая проверка сразу при старте (инициализация lastCheckedTaskId)
(async () => {
  try {
    const url = `${process.env.BITRIX_WEBHOOK_URL}tasks.task.list?filter[RESPONSIBLE_ID]=${process.env.TARGET_BITRIX_USER_ID}&order[ID]=DESC&select[]=ID`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.result && data.result.tasks && data.result.tasks.length > 0) {
      lastCheckedTaskId = parseInt(data.result.tasks[0].id);
      console.log(`🔄 Initialized with last task ID: ${lastCheckedTaskId}`);
    }
  } catch (e) {
    console.error('Init error:', e.message);
  }
})();

// Healthcheck endpoint
app.get('/', (req, res) => res.send('OK'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Polling service listening on port ${port}`));
