const status = document.querySelector('#status');
const addDeviceButton = document.querySelector('#addDevice');
const sendNowButton = document.querySelector('#sendNow');
const removeDeviceButton = document.querySelector('#removeDevice');

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

  if (!configResponse.ok) {
    const body = await configResponse.text();
    throw new Error(
      `/api/config returned ${configResponse.status}: ${body.slice(0, 120)}`
    );
  }

  const config = await configResponse.json();

  if (!config.publicVapidKey) {
    throw new Error('The API response does not contain publicVapidKey.');
  }

  publicVapidKey = config.publicVapidKey;

  const subscription = await registration.pushManager.getSubscription();
  const count = await deviceCount();

  if (subscription && Notification.permission === 'granted') {
    setStatus(`This device is already added. Total devices: ${count}.`);

    addDeviceButton.disabled = true;
    addDeviceButton.textContent = 'This device is added';

    removeDeviceButton.disabled = false;
    sendNowButton.disabled = false;
    return;
  }

  setStatus(`Ready. Devices currently added: ${count}.`);
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
    removeDeviceButton.disabled = false;
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

removeDeviceButton.addEventListener('click', async () => {
  try {
    removeDeviceButton.disabled = true;
    setStatus('Removing this device…');

    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      setStatus('This browser has no active push subscription.');
      addDeviceButton.disabled = false;
      addDeviceButton.textContent = 'Add this device';
      sendNowButton.disabled = true;
      return;
    }

    const response = await fetch('/api/devices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });

    if (!response.ok) {
      throw new Error('Could not remove this device from the server.');
    }

    const unsubscribed = await subscription.unsubscribe();

    if (!unsubscribed) {
      console.warn('The subscription was already inactive in the browser.');
    }

    const count = await deviceCount();

    setStatus(`This device was removed. Remaining devices: ${count}.`);

    addDeviceButton.disabled = false;
    addDeviceButton.textContent = 'Add this device';
    sendNowButton.disabled = true;
  } catch (error) {
    console.error(error);
    setStatus(`Could not remove device: ${error.message}`);

    const currentSubscription =
      await registration.pushManager.getSubscription();

    removeDeviceButton.disabled = !currentSubscription;
  }
});