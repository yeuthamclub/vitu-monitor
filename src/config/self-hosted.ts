/**
 * True in builds made for self-hosting. The Docker image sets
 * VITE_SELF_HOSTED=1; hosted (Vercel) and desktop builds leave it unset.
 *
 * Self-hosted builds do not contact World Monitor's hosted services: no Umami
 * analytics script and no map CDN fetches. Same-origin assets are used instead.
 * Read the flag only through this module, so every gate agrees on its meaning.
 */
export const SELF_HOSTED_BUILD: boolean = (() => {
  try {
    return import.meta.env.VITE_SELF_HOSTED === '1';
  } catch {
    return false;
  }
})();

/**
 * Hosts where the variant switcher stores the choice and reloads in place
 * instead of navigating to a hosted `<variant>.worldmonitor.app` dashboard:
 * loopback dev servers, and every host of a self-hosted build.
 */
export function switchesVariantInApp(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || SELF_HOSTED_BUILD;
}
