// Fork-only (Realtime Monitor), PHASE-0-1-PLAN PR-1d: Vietnamese feed quirks.
// Fixtures in tests/fixtures/vn-feeds/ are synthetic headlines that reproduce
// the encoding and date shapes the live feeds sent on 2026-10-24.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { VARIANT_FEEDS } from '../server/worldmonitor/news/v1/_feeds';
import { decodeFeedText, parseFeedDateMs } from '../server/worldmonitor/news/v1/_feed-text';
import { __testing__ as digest } from '../server/worldmonitor/news/v1/list-feed-digest';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/vn-feeds/${name}`, import.meta.url), 'utf8');
const vnFeed = (name: string) => {
  const feed = Object.values(VARIANT_FEEDS.vietnam!).flat().find((f) => f.name === name);
  assert.ok(feed, `${name} is configured in VARIANT_FEEDS.vietnam`);
  return feed;
};
const parse = (file: string, feedName: string) => {
  const result = digest.parseRssXml(fixture(file), vnFeed(feedName), 'vietnam');
  assert.ok(result, `${file} parses`);
  return result;
};
// Vietnam is UTC+7 all year (no daylight saving).
const vnTime = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h - 7, mi, s);

describe('Vietnamese feed quirks (PR-1d)', () => {
  it('decodes HTML named entities that Thanh Niên writes inside CDATA', () => {
    const { items } = parse('thanhnien.xml', 'Thanh Niên');
    assert.deepEqual(items.map((i) => i.title), [
      'Đề xuất mở rộng thư viện số cho học sinh vùng cao, sinh viên nghèo',
      'Giá xăng giảm nhẹ – kỳ điều hành mới',
    ]);
    assert.ok(items.every((i) => !/&[a-z]+;/i.test(i.title)), 'no entity survives in a title');
    // Two-digit year with +0700.
    assert.equal(items[0]!.publishedAt, vnTime(2026, 10, 20, 9, 50));
  });

  it("reads Tuổi Trẻ's zoneless M/D/YYYY h:mm:ss AM dates as Vietnam time", () => {
    const { items, droppedUndated } = parse('tuoitre.xml', 'Tuổi Trẻ');
    assert.equal(droppedUndated ?? 0, 0);
    assert.deepEqual(items.map((i) => i.publishedAt), [
      vnTime(2026, 10, 20, 8, 7),
      vnTime(2026, 10, 19, 23, 34),
    ]);
  });

  it('accepts the +07 and +07:00 offsets VTV and VietnamPlus send', () => {
    assert.equal(parse('vtv.xml', 'VTV').items[0]!.publishedAt, vnTime(2026, 10, 20, 9, 21));
    assert.equal(parse('vietnamplus.xml', 'VietnamPlus').items[0]!.publishedAt, vnTime(2026, 10, 20, 9, 46, 1));
  });

  it('normalises decomposed (NFD) diacritics to NFC', () => {
    const title = parse('vtv.xml', 'VTV').items[0]!.title;
    assert.equal(title, 'Mưa lớn ở miền Trung, nhiều tuyến đường ngập sâu');
    assert.equal(title, title.normalize('NFC'));
  });

  it('keeps the plain-text path single-decoding and markup-free', () => {
    const xml = '<rss><channel><item><title>Gi&amp;oacute; &lt;b&gt; v&agrave; &amp; &unknown;</title>'
      + '<link>https://vnexpress.net/a-1.html</link><pubDate>Tue, 20 Oct 2026 09:00:00 +0700</pubDate></item></channel></rss>';
    const { items } = digest.parseRssXml(xml, vnFeed('VnExpress Thời sự'), 'vietnam')!;
    // Double-escaped safe names decode (Thanh Niên sends `&amp;apos;`); an
    // escaped markup reference stays one level escaped; unknown names survive.
    assert.equal(items[0]!.title, 'Gió <b> và & &unknown;');
    const twice = '<rss><channel><item><title><![CDATA[&amp;apos;mệnh lệnh&amp;apos; &amp;lt;i&amp;gt;]]></title>'
      + '<link>https://thanhnien.vn/a-1.htm</link><pubDate>Tue, 20 Oct 26 09:00:00 +0700</pubDate></item></channel></rss>';
    assert.equal(digest.parseRssXml(twice, vnFeed('Thanh Niên'), 'vietnam')!.items[0]!.title, "'mệnh lệnh' &amp;lt;i&amp;gt;");
  });
});

describe('decodeFeedText', () => {
  it('never decodes the markup-forming entities', () => {
    assert.equal(decodeFeedText('&lt;script&gt; &amp; &amp;lt;b&amp;gt;'), '&lt;script&gt; &amp; &amp;lt;b&amp;gt;');
  });
  it('decodes quotes, single or double escaped', () => {
    assert.equal(decodeFeedText('&quot;x&quot; &apos;y&apos; &amp;apos;z&amp;apos;'), `"x" 'y' 'z'`);
  });
  it('decodes letters, Vietnamese-specific names and typography', () => {
    assert.equal(decodeFeedText('&Dstrok;&agrave; N&abreve;ng &hellip; &ldquo;x&rdquo;'), 'Đà Năng … “x”');
  });
  it('decodes safe numeric references but never < > & or out-of-range ones', () => {
    // Thanh Niên also sends `&#039;` inside CDATA.
    assert.equal(decodeFeedText('&#039;ế&#039; &#x1EBF;'), "'ế' ế");
    assert.equal(decodeFeedText('&#60;b&#62; &#38; &#x3C; &#99999999;'), '&#60;b&#62; &#38; &#x3C; &#99999999;');
  });
});

describe('parseFeedDateMs', () => {
  const vn = 'https://tuoitre.vn/rss/thoi-su.rss';
  it('anchors zoneless dates to +07:00 only for .vn hosts', () => {
    assert.equal(parseFeedDateMs('10/20/2026 8:07:00\u202fAM', vn), vnTime(2026, 10, 20, 8, 7));
    assert.equal(parseFeedDateMs('2026-10-20T08:07:00', vn), vnTime(2026, 10, 20, 8, 7));
    const elsewhere = 'https://example.com/feed.xml';
    assert.equal(parseFeedDateMs('10/20/2026 8:07:00 AM', elsewhere), new Date('10/20/2026 8:07:00 AM').getTime());
  });
  it('leaves explicit zones alone, wherever the feed lives', () => {
    for (const s of ['Tue, 20 Oct 2026 09:21:00 +0700', 'Tue, 20 Oct 2026 09:21:00 +07', 'Tue, 20 Oct 2026 02:21:00 GMT', '2026-10-20T02:21:00Z']) {
      assert.equal(parseFeedDateMs(s, vn), vnTime(2026, 10, 20, 9, 21), s);
    }
  });
  it('still reports unparseable dates as NaN', () => {
    assert.ok(Number.isNaN(parseFeedDateMs('không phải ngày', vn)));
    // V8 would accept text + ' GMT+0700'; only known zoneless shapes are anchored.
    assert.ok(Number.isNaN(parseFeedDateMs('cập nhật lúc 8 giờ', vn)));
  });
});
