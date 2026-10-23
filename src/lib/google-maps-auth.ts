type AuthFailureTarget = { gm_authFailure?: () => void };
type Subscription = { listeners: Set<() => void>; restore: () => void };

const subscriptions = new WeakMap<AuthFailureTarget, Subscription>();
const failedTargets = new WeakSet<AuthFailureTarget>();

declare global {
  interface Window { gm_authFailure?: () => void; }
}

// Google reports runtime key/referrer failures through this global callback.
// https://developers.google.com/maps/documentation/javascript/events#auth-errors
export function subscribeToGoogleMapsAuthFailure(target: AuthFailureTarget, onFailure: () => void) {
  let subscription = subscriptions.get(target);
  if (!subscription) {
    const previous = target.gm_authFailure;
    const listeners = new Set<() => void>();
    const handler = () => {
      failedTargets.add(target);
      try { previous?.call(target); }
      finally { for (const listener of [...listeners]) listener(); }
    };
    // Restore another consumer's callback only after our final map unmounts.
    const restore = () => {
      if (target.gm_authFailure === handler) {
        if (previous) target.gm_authFailure = previous;
        else delete target.gm_authFailure;
      }
    };
    subscription = { listeners, restore };
    subscriptions.set(target, subscription);
    target.gm_authFailure = handler;
  }
  subscription.listeners.add(onFailure);
  if (failedTargets.has(target)) onFailure();

  const active = subscription;
  return () => {
    active.listeners.delete(onFailure);
    if (active.listeners.size !== 0 || subscriptions.get(target) !== active) return;
    active.restore();
    subscriptions.delete(target);
  };
}
