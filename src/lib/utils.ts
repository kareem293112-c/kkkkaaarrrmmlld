export const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  let target = input;
  if (typeof target === 'string' && target.startsWith('/api/')) {
    const isAiStudioOrLocal = window.location.hostname.includes('run.app') || 
                              window.location.hostname.includes('localhost') || 
                              window.location.hostname.includes('127.0.0.1') ||
                              window.location.hostname.includes('googleusercontent.com') ||
                              window.location.hostname.includes('google.com') ||
                              window.location.hostname.includes('sandbox.google.com');
    const apiBaseUrl = isAiStudioOrLocal ? '' : (import.meta.env.VITE_API_URL || '');
    target = `${apiBaseUrl}${target}`;
  }
  return window.fetch(target, init);
};

export const getXpForNextUserLevel = (level: number) => {
  return level * 150 + 100;
};

export const getXpForNextRoomLevel = (level: number) => {
  return level * 300 + 200;
};
