/**
 * Feed text and date quirks seen on publisher RSS (fork: Realtime Monitor,
 * first found on Vietnamese feeds — PHASE-0-1-PLAN PR-1d).
 *
 * - Thanh Niên writes HTML named entities inside CDATA (`h&oacute;a`), which
 *   XML never decodes, so titles reached panels as `h&oacute;a`.
 * - Some feeds ship decomposed (NFD) diacritics; the dashboard compares and
 *   clusters titles as strings, so text is normalised to NFC.
 * - Tuổi Trẻ and Báo Chính phủ send `10/24/2026 8:07:00 AM` with no zone. The
 *   runtime reads a zoneless date as its own local time (UTC on the edge and in
 *   Docker), which put those items 7 hours in the future, so the strict date
 *   gate dropped them. Zoneless dates from a host under a listed country TLD are
 *   read in that country's offset instead.
 */

// Letters and punctuation only. lt, gt and amp are deliberately absent, so
// decoding can never create markup; decodeXmlEntities still owns those for
// plain (non-CDATA) text. Quotes are harmless in text and Thanh Niên sends them.
const NAMED_ENTITY_CODEPOINTS: Readonly<Record<string, number>> = Object.freeze({
  quot: 0x22, apos: 0x27,
  nbsp: 0xa0, iexcl: 0xa1, cent: 0xa2, pound: 0xa3, curren: 0xa4, yen: 0xa5, brvbar: 0xa6,
  sect: 0xa7, uml: 0xa8, copy: 0xa9, ordf: 0xaa, laquo: 0xab, not: 0xac, shy: 0xad, reg: 0xae,
  macr: 0xaf, deg: 0xb0, plusmn: 0xb1, sup2: 0xb2, sup3: 0xb3, acute: 0xb4, micro: 0xb5,
  para: 0xb6, middot: 0xb7, cedil: 0xb8, sup1: 0xb9, ordm: 0xba, raquo: 0xbb, frac14: 0xbc,
  frac12: 0xbd, frac34: 0xbe, iquest: 0xbf, Agrave: 0xc0, Aacute: 0xc1, Acirc: 0xc2,
  Atilde: 0xc3, Auml: 0xc4, Aring: 0xc5, AElig: 0xc6, Ccedil: 0xc7, Egrave: 0xc8, Eacute: 0xc9,
  Ecirc: 0xca, Euml: 0xcb, Igrave: 0xcc, Iacute: 0xcd, Icirc: 0xce, Iuml: 0xcf, ETH: 0xd0,
  Ntilde: 0xd1, Ograve: 0xd2, Oacute: 0xd3, Ocirc: 0xd4, Otilde: 0xd5, Ouml: 0xd6, times: 0xd7,
  Oslash: 0xd8, Ugrave: 0xd9, Uacute: 0xda, Ucirc: 0xdb, Uuml: 0xdc, Yacute: 0xdd, THORN: 0xde,
  szlig: 0xdf, agrave: 0xe0, aacute: 0xe1, acirc: 0xe2, atilde: 0xe3, auml: 0xe4, aring: 0xe5,
  aelig: 0xe6, ccedil: 0xe7, egrave: 0xe8, eacute: 0xe9, ecirc: 0xea, euml: 0xeb, igrave: 0xec,
  iacute: 0xed, icirc: 0xee, iuml: 0xef, eth: 0xf0, ntilde: 0xf1, ograve: 0xf2, oacute: 0xf3,
  ocirc: 0xf4, otilde: 0xf5, ouml: 0xf6, divide: 0xf7, oslash: 0xf8, ugrave: 0xf9, uacute: 0xfa,
  ucirc: 0xfb, uuml: 0xfc, yacute: 0xfd, thorn: 0xfe, yuml: 0xff, Abreve: 0x102, abreve: 0x103,
  Dstrok: 0x110, dstrok: 0x111, ensp: 0x2002, emsp: 0x2003, thinsp: 0x2009, ndash: 0x2013,
  mdash: 0x2014, lsquo: 0x2018, rsquo: 0x2019, sbquo: 0x201a, ldquo: 0x201c, rdquo: 0x201d,
  bdquo: 0x201e, bull: 0x2022, hellip: 0x2026, lsaquo: 0x2039, rsaquo: 0x203a, euro: 0x20ac,
  trade: 0x2122,
});

// The API tsconfig's lib predates Object.hasOwn.
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// Numeric references that would form markup (< > &) stay encoded, as do
// out-of-range ones; decodeXmlEntities handles those on the plain-text path.
const MARKUP_CODEPOINTS = new Set([0x26, 0x3c, 0x3e]);

/** Code point for one safe reference body (`oacute`, `#039`, `#x1EBF`), else null. */
function safeReferenceCodePoint(ref: string): number | null {
  if (ref[0] !== '#') return hasOwn(NAMED_ENTITY_CODEPOINTS, ref) ? NAMED_ENTITY_CODEPOINTS[ref]! : null;
  const cp = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !MARKUP_CODEPOINTS.has(cp) ? cp : null;
}

/**
 * Decode safe named and numeric references (`&oacute;`, `&#039;`), including
 * the double-escaped form Thanh Niên also sends (`&amp;apos;`), then normalise
 * to NFC. Unknown or markup-forming references stay as written.
 */
export function decodeFeedText(s: string): string {
  return s
    .replace(/&(?:amp;)?(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,7});/g, (whole, ref: string) => {
      const cp = safeReferenceCodePoint(ref);
      return cp === null ? whole : String.fromCodePoint(cp);
    })
    .normalize('NFC');
}

// Country-TLD feeds whose zoneless dates are local time. Only offsets without
// daylight saving belong here: a fixed offset is wrong half the year otherwise.
const ZONELESS_DATE_OFFSET_BY_TLD: Readonly<Record<string, string>> = Object.freeze({
  vn: '+07:00',
});

// The two zoneless shapes seen on .vn feeds. Only these are anchored: V8's
// lenient parser turns almost any text plus " GMT+0700" into a valid date, so
// anchoring free text would mint timestamps for garbage.
const ISO_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const US_LOCAL_RE = /^\d{1,2}\/\d{1,2}\/\d{4}(?: \d{1,2}:\d{2}(?::\d{2})?(?: ?[AP]M)?)?$/i;

function zonelessOffsetFor(feedUrl: string): string | null {
  try {
    const tld = new URL(feedUrl).hostname.split('.').pop() ?? '';
    return hasOwn(ZONELESS_DATE_OFFSET_BY_TLD, tld) ? ZONELESS_DATE_OFFSET_BY_TLD[tld]! : null;
  } catch {
    return null;
  }
}

/**
 * Parse a feed date to epoch ms (NaN when unparseable). Narrow and ordinary
 * no-break spaces (`8:07:00\u202fAM`) count as spaces. A zoneless date from a
 * listed country-TLD host is read in that country's offset; everything else
 * parses exactly as `new Date(raw)` did.
 */
export function parseFeedDateMs(raw: string, feedUrl: string): number {
  const s = raw.replace(/[\u00a0\u202f]/g, ' ').trim();
  const offset = zonelessOffsetFor(feedUrl);
  if (offset && ISO_LOCAL_RE.test(s)) return new Date(`${s}${offset}`).getTime();
  if (offset && US_LOCAL_RE.test(s)) return new Date(`${s} GMT${offset.replace(':', '')}`).getTime();
  return new Date(s).getTime();
}
