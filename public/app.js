const status = document.querySelector('#status');
const addDeviceButton = document.querySelector('#addDevice');
const sendNowButton = document.querySelector('#sendNow');

let registration;
let publicVapidKey;

function setStatus(message) {
  status.textContent = message;
}

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const bytes = atob(base64);

  return Uint8Array.from([...bytes].map(character => character.charCodeAt(0)));
}

async function deviceCount() {
  const response = await fetch('/api/devices');
  const data = await response.json();
  return data.count;
}

async function start() {
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    setStatus('Web Push is not supported by this browser.');
    addDeviceButton.disabled = true;
    return;
  }

  registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const configResponse = await fetch('/api/config');
  const config = await configResponse.json();
  publicVapidKey = config.publicVapidKey;

  const subscription = await registration.pushManager.getSubscription();
  const count = await deviceCount();

  if (subscription && Notification.permission === 'granted') {
    setStatus(`This device is already added. Total devices: ${count}.`);
    addDeviceButton.disabled = true;
    addDeviceButton.textContent = 'This device is added';
    sendNowButton.disabled = false;
  } else {
    setStatus(`Ready. Devices currently added: ${count}.`);
  }
}

addDeviceButton.addEventListener('click', async () => {
  try {
    addDeviceButton.disabled = true;

    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      setStatus('Notification permission was not granted.');
      addDeviceButton.disabled = false;
      return;
    }

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicVapidKey)
      });
    }

    const response = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    if (!response.ok) {
      throw new Error('Could not save this device.');
    }

    const count = await deviceCount();

    setStatus(`This device was added. Total devices: ${count}.`);
    addDeviceButton.textContent = 'This device is added';
    sendNowButton.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`);
    addDeviceButton.disabled = false;
  }
});

sendNowButton.addEventListener('click', async () => {
  try {
    sendNowButton.disabled = true;
    setStatus('Sending notification…');

    const response = await fetch('/api/send-now', {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error('Could not send notification.');
    }

    const result = await response.json();

    setStatus(
      `Sent notification to ${result.delivered} of ${result.devices} device(s).`
    );
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`);
  } finally {
    sendNowButton.disabled = false;
  }
});

start().catch(error => {
  console.error(error);
  setStatus(`Startup error: ${error.message}`);
});