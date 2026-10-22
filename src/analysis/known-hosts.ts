/**
 * Allowlist of well-known common websites, keyed by registrable domain
 * (eTLD+1 per `src/shared/psl.ts`). For a page whose registrable domain is on
 * this list, the assessment downgrades its handling of medium-severity
 * findings: they still render in the findings panel for transparency, but
 * they do NOT promote the overall state to "Review recommended". Large
 * legitimate sites routinely match medium rules (form↔network, capability
 * →network) during normal use, so letting those alone flip the headline
 * confuses users without adding signal.
 *
 * High-severity findings (sustained cross-origin POST bursts, capability
 * followed by a cross-origin POST) STILL promote the state to "Suspicious
 * activity detected" even on allowlisted hosts — the allowlist trusts the
 * site's identity, not its every observed behavior.
 *
 * The list is intentionally short and user-editable here; nothing else in the
 * product depends on these hostnames and no network calls are made with them.
 * Source: project-provided curation (~90 common sites).
 */
import { registrableDomain } from '../shared/psl';

export const KNOWN_COMMON_HOSTS: ReadonlySet<string> = new Set<string>([
  // Search, social, communication, video.
  'google.com', 'youtube.com', 'chatgpt.com',
  'instagram.com', 'facebook.com', 'x.com', 'tiktok.com', 'reddit.com',
  'linkedin.com', 'pinterest.com', 'snapchat.com', 'whatsapp.com',
  'telegram.org', 'discord.com', 'twitch.tv', 'netflix.com',
  // Shopping and retail.
  'amazon.com', 'flipkart.com', 'ebay.com', 'etsy.com', 'walmart.com', 'aliexpress.com',
  // Technology, email, cloud.
  'microsoft.com', 'apple.com', 'live.com', 'yahoo.com',
  // Reference and Q&A.
  'wikipedia.org', 'britannica.com', 'medium.com', 'quora.com', 'stackoverflow.com',
  // Developer and coding.
  'github.com', 'gitlab.com', 'bitbucket.org', 'codepen.io', 'replit.com',
  'w3schools.com', 'mozilla.org', 'freecodecamp.org', 'geeksforgeeks.org',
  'leetcode.com', 'hackerrank.com',
  // Learning and research.
  'kaggle.com', 'coursera.org', 'edx.org', 'udemy.com', 'khanacademy.org',
  'researchgate.net', 'arxiv.org', 'ieee.org', 'acm.org',
  // Design and productivity.
  'canva.com', 'figma.com', 'adobe.com', 'notion.so', 'trello.com',
  'slack.com', 'zoom.us',
  // Storage, music, streaming.
  'dropbox.com', 'spotify.com', 'soundcloud.com',
  'imdb.com', 'rottentomatoes.com', 'disneyplus.com', 'primevideo.com', 'hulu.com',
  // News and sports.
  'bbc.com', 'cnn.com', 'reuters.com', 'nytimes.com', 'theguardian.com',
  'espn.com', 'fifa.com', 'espncricinfo.com',
  // Weather.
  'weather.com', 'accuweather.com',
  // Travel, maps, transport.
  'booking.com', 'airbnb.com', 'tripadvisor.com', 'uber.com', 'lyft.com', 'maps.me',
  // Payments and finance.
  'paypal.com', 'stripe.com', 'wise.com', 'investopedia.com', 'tradingview.com',
  // Maps and archives.
  'openstreetmap.org', 'archive.org',
]);

/** True when `host`'s registrable domain is on the allowlist above. */
export function isKnownCommonHost(host: string | undefined): boolean {
  if (!host) return false;
  return KNOWN_COMMON_HOSTS.has(registrableDomain(host));
}
