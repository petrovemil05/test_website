import 'dotenv/config';
import express from 'express';
import webpush from 'web-push';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const {
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
} = process.env;

if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  throw new Error('Missing VAPID environment variables. Check .env.');
}

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const db = new Database(path.join(__dirname, 'push.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const getAllSubscriptions = db.prepare(`
  SELECT endpoint, p256dh, auth
  FROM subscriptions
`);

const saveSubscription = db.prepare(`
  INSERT INTO subscriptions (endpoint, p256dh, auth)
  VALUES (@endpoint, @p256dh, @auth)
  ON CONFLICT(endpoint) DO UPDATE SET
    p256dh = excluded.p256dh,
    auth = excluded.auth
`);

const deleteSubscription = db.prepare(`
  DELETE FROM subscriptions WHERE endpoint = ?
`);

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function toPushSubscription(row) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth
    }
  };
}

async function sendToDevice(row, payload) {
  try {
    await webpush.sendNotification(
      toPushSubscription(row),
      JSON.stringify(payload),
      { TTL: 60 * 60 }
    );

    return true;
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      deleteSubscription.run(row.endpoint);
      console.log('Removed expired device subscription');
    } else {
      console.error('Push error:', error.statusCode, error.body || error.message);
    }

    return false;
  }
}

async function sendToAllDevices() {
  const devices = getAllSubscriptions.all();

  const payload = {
    title: 'Push Test',
    body: `Automatic test: ${new Date().toLocaleString()}`,
    url: '/',
    tag: `test-${Date.now()}`
  };

  const results = await Promise.all(
    devices.map(device => sendToDevice(device, payload))
  );

  const delivered = results.filter(Boolean).length;

  console.log(
    `[${new Date().toISOString()}] Sent to ${delivered}/${devices.length} device(s)`
  );

  return { devices: devices.length, delivered };
}

app.get('/api/config', (_, res) => {
  res.json({ publicVapidKey: VAPID_PUBLIC_KEY });
});

app.get('/api/devices', (_, res) => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM subscriptions').get().count;
  res.json({ count });
});

app.post('/api/devices', async (req, res) => {
  const subscription = req.body;

  if (
    !subscription?.endpoint ||
    !subscription?.keys?.p256dh ||
    !subscription?.keys?.auth
  ) {
    return res.status(400).json({ error: 'Invalid device subscription.' });
  }

  saveSubscription.run({
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth
  });

  res.status(201).json({ ok: true });
});

app.post('/api/send-now', async (_, res) => {
  const result = await sendToAllDevices();
  res.json({ ok: true, ...result });
});

setInterval(() => {
  sendToAllDevices().catch(console.error);
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
  console.log('Automatic notification interval: 30 minutes');
});