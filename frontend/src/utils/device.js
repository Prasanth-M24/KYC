function hashString(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function getDeviceContext() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const language = navigator.language || '';
  const screenSize = `${window.screen.width}x${window.screen.height}`;
  const seed = [
    navigator.userAgent,
    navigator.platform,
    language,
    timezone,
    screenSize,
    navigator.hardwareConcurrency || 0,
  ].join('|');

  return {
    fingerprint: `dev_${hashString(seed)}`,
    userAgent: navigator.userAgent,
    platform: navigator.platform || '',
    language,
    timezone,
    screenSize,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    webdriver: Boolean(navigator.webdriver),
  };
}

export function getStoredDeviceContext() {
  const stored = sessionStorage.getItem('deviceContext');
  if (stored) {
    return JSON.parse(stored);
  }

  const context = getDeviceContext();
  sessionStorage.setItem('deviceContext', JSON.stringify(context));
  return context;
}

export async function getOptionalGeolocation() {
  if (!('geolocation' in navigator)) {
    return null;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: Number(position.coords.latitude.toFixed(5)),
          lng: Number(position.coords.longitude.toFixed(5)),
        });
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 }
    );
  });
}
