import express from 'express';
import 'dotenv/config';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/webhook', async (req, res) => {
  const fields = req.body?.data?.FIELDS_AFTER ?? req.body;
  const { ID: taskId, RESPONSIBLE_ID, TITLE, CREATED_BY_NAME } = fields;

  if (String(RESPONSIBLE_ID) === String(process.env.TARGET_BITRIX_USER_ID) && taskId) {
    const taskUrl = `${process.env.PORTAL_URL}/company/personal/user/${RESPONSIBLE_ID}/tasks/task/view/${taskId}/`;
    const text = `📋 Новая задача: ${TITLE}\n👤 Постановщик: ${CREATED_BY_NAME}\n🔗 ${taskUrl}`;

    try {
      const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error('Telegram error:', err);
      }
    } catch (e) {
      console.error('Fetch error:', e.message);
    }
  }

  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Webhook listening on port ${port}`));
