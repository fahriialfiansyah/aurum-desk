'use client';

export type NotifyPermission = NotificationPermission | 'unsupported';

export function notificationPermission(): NotifyPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/** Must be called from a user gesture (button click). */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (notificationPermission() === 'unsupported') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export function showBrowserNotification(title: string, body: string, tag: string): void {
  if (notificationPermission() !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => window.focus();
  } catch {
    /* some browsers throw outside a service worker; toasts still cover it */
  }
}
