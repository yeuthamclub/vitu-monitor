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
