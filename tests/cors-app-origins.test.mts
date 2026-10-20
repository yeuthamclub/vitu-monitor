import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The allowlists read APP_ORIGINS once at module load, and node:test runs each
// file in its own process, so set it before the dynamic imports below.
process.env.APP_ORIGINS = [
  'http://realtime-monitor.localhost:3000',
  ' https://monitor.example.vn/ ',
  'https://evil.example/path',
  'https://user:pw@evil.example',
  'https://*.evil.example',
  'not a url',
].join(',');

const serverCors = await import('../server/cors.ts');
const apiCors = await import('../api/_cors.js');
const { default: youtubeEmbed } = await import('../api/youtube/embed.js');

const request = (origin: string) =>
  new Request('http://realtime-monitor.localhost:3000/api/x', { headers: { Origin: origin } });

const ALLOWED = ['http://realtime-monitor.localhost:3000', 'https://monitor.example.vn', 'https://monitor.example.vn.'];
const REFUSED = [
  'https://evil.example',
  'https://sub.monitor.example.vn',
  'http://monitor.example.vn',
  'http://realtime-monitor.localhost:3001',
  'https://a.evil.example',
];

describe('APP_ORIGINS parsing', () => {
  for (const [label, parse] of [
    ['api/_cors.js', apiCors.parseConfiguredAppOrigins],
    ['server/cors.ts', serverCors.parseConfiguredAppOrigins],
  ] as const) {
    it(`${label} keeps exact http(s) origins only`, () => {
      assert.deepEqual(
        [...parse(process.env.APP_ORIGINS)].sort(),
        ['http://realtime-monitor.localhost:3000', 'https://monitor.example.vn'],
      );
      assert.equal(parse(undefined).size, 0);
      assert.equal(parse('').size, 0);
    });
  }
});

describe('configured app origins are trusted on every surface', () => {
  for (const origin of ALLOWED) {
    it(`allows ${origin}`, () => {
      assert.equal(serverCors.isAllowedOrigin(origin), true, 'server/cors.ts');
      assert.equal(apiCors.isDisallowedOrigin(request(origin)), false, 'api/_cors.js');
      assert.equal(serverCors.getCorsHeaders(request(origin))['Access-Control-Allow-Origin'], origin);
      assert.equal(apiCors.getCorsHeaders(request(origin))['Access-Control-Allow-Origin'], origin);
    });
  }
  for (const origin of REFUSED) {
    it(`refuses ${origin}`, () => {
      assert.equal(serverCors.isAllowedOrigin(origin), false, 'server/cors.ts');
      assert.equal(apiCors.isDisallowedOrigin(request(origin)), true, 'api/_cors.js');
    });
  }

  it('treats a configured origin as a hosted app origin (OAuth consent boundary)', () => {
    assert.equal(apiCors.isHostedAppOrigin('http://realtime-monitor.localhost:3000'), true);
    assert.equal(apiCors.isHostedAppOrigin('https://evil.example'), false);
    // Upstream hosts keep working unchanged.
    assert.equal(apiCors.isHostedAppOrigin('https://worldmonitor.app'), true);
  });
});

describe('YouTube embed accepts a configured parent origin', () => {
  const render = async (parentOrigin: string) => {
    const url = new URL('http://realtime-monitor.localhost:3000/api/youtube/embed');
    url.searchParams.set('videoId', 'iEpJwprxDdk');
    url.searchParams.set('origin', 'http://realtime-monitor.localhost:3000');
    url.searchParams.set('parentOrigin', parentOrigin);
    const html = await (await youtubeEmbed(new Request(url))).text();
    const config = html.match(/<script type="application\/json" id="player-config">([^<]*)<\/script>/);
    assert.ok(config, 'player config script is rendered');
    return JSON.parse(config[1]) as { origin: string; parentOrigin: string };
  };

  it('posts messages to the configured app origin', async () => {
    const config = await render('http://realtime-monitor.localhost:3000');
    assert.equal(config.origin, 'http://realtime-monitor.localhost:3000');
    assert.equal(config.parentOrigin, 'http://realtime-monitor.localhost:3000');
  });

  it('still falls back for an unlisted parent', async () => {
    const config = await render('https://evil.example');
    assert.equal(config.parentOrigin, 'http://realtime-monitor.localhost:3000');
  });
});
