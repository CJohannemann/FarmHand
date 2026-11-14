/**
 * Phone notifications: turning them on for this phone, and keeping the
 * server's note of it current. What gets sent, and when, is
 * deploy/selfhost/send-notifications.ts; public/sw.js shows it.
 *
 * The same approach as PropertyManagement's src/lib/push.ts, including its
 * two hard-won iPhone lessons (see subscribe below and needsHomeScreen).
 */
import { supabase } from './supabase'

const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

/** Whether this browser, and this build, can do Web Push at all. */
export const pushSupported =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  VAPID_PUBLIC_KEY.length > 0

/** The browser's own permission — not whether the server has this phone. */
export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported ? Notification.permission : 'unsupported'
}

/**
 * An iPhone only offers notifications to a site added to the home screen
 * and opened from there; in a Safari tab PushManager doesn't exist. Told
 * apart from "can't", so Settings can say how rather than offer nothing.
 */
export function needsHomeScreen(): boolean {
  if (typeof window === 'undefined' || VAPID_PUBLIC_KEY.length === 0) return false
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios && !standalone
}

// applicationServerKey wants the VAPID public key as bytes, not base64url.
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))])
}

async function subscribe(): Promise<PushSubscription> {
  await navigator.serviceWorker.register('/sw.js')
  // subscribe() needs an *active* worker; register() resolves while it is
  // still installing, which on an iPhone always loses the race. `ready`
  // waits for active.
  const registration = await withTimeout(navigator.serviceWorker.ready, 15000,
    'The notification service took too long to start — close the app and try again.')
  return (await registration.pushManager.getSubscription())
    ?? registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) })
}

async function register(sub: PushSubscription): Promise<void> {
  if (!supabase) throw new Error('Not connected to an account.')
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('The phone gave an incomplete notification address.')
  }
  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
  })
  if (error) throw new Error(error.message)
}

/**
 * Asks permission, subscribes, and tells the server. Must run from a tap —
 * browsers ignore a permission prompt that isn't.
 */
export async function turnOnAlerts(): Promise<void> {
  if (!pushSupported) throw new Error("This phone or browser can't show notifications.")
  if (await Notification.requestPermission() !== 'granted') {
    throw new Error('Notifications were not allowed. They can be allowed in the phone\'s Settings, under FarmHand.')
  }
  await register(await subscribe())
}

/** Stops alerts on this phone: unsubscribes, and the server forgets it. */
export async function turnOffAlerts(): Promise<void> {
  if (!pushSupported) return
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = await registration?.pushManager.getSubscription()
  if (!sub) return
  if (supabase) await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint })
  await sub.unsubscribe()
}

/** Whether this phone is subscribed right now. */
export async function alertsOn(): Promise<boolean> {
  if (!pushSupported || Notification.permission !== 'granted') return false
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  return !!(await registration?.pushManager.getSubscription())
}

/**
 * Run on each start while signed in: where permission is already given,
 * makes sure the server has this phone, under whoever is signed in now.
 * Quietly repairs a phone whose first attempt got permission but never
 * reached the server — PropertyManagement's lesson — with no prompt.
 */
export async function keepAlertsRegistered(): Promise<void> {
  if (!pushSupported || Notification.permission !== 'granted') return
  try { await register(await subscribe()) } catch { /* tried again next start */ }
}
