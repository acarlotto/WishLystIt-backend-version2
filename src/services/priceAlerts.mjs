import cron from "node-cron";
import { db } from "../app.mjs";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const SERPAPI_URL = "https://serpapi.com/search.json";
const PRICE_ALERT_COOLDOWN_HOURS = 24;
const ITEM_DELAY_MS = 1700;
const CACHE_TTL_MS = Number.parseInt(process.env.PRICE_CACHE_TTL_MS || "1800000", 10);
const DOMAIN_MIN_INTERVAL_MS = Number.parseInt(
  process.env.PRICE_DOMAIN_MIN_INTERVAL_MS || "1200",
  10
);
const HTML_TOO_SMALL_THRESHOLD = Number.parseInt(
  process.env.PRICE_HTML_MIN_LENGTH || "1200",
  10
);
const SCRAPE_MIN_CONFIDENCE = process.env.PRICE_MIN_CONFIDENCE || "medium";
const USER_AGENTS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];
const CONFIDENCE_SCORE = { low: 1, medium: 2, high: 3 };
const priceCache = new Map();
const domainLastRequestAt = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseNumericPrice = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const cleaned = value.replace(/[^0-9.]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePriceWithCurrency = (value) => {
  if (value === null || value === undefined) return { price: null, currency: null };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { price: value, currency: null };
  }
  const text = String(value);
  const currencyMatch = text.match(/(USD|EUR|GBP|CAD|AUD|JPY|\$|€|£)/i);
  const currency = currencyMatch ? currencyMatch[1].toUpperCase() : null;
  return { price: parseNumericPrice(text), currency };
};

const normalizeCandidate = ({ value, source, confidence, method }) => {
  const parsed = parsePriceWithCurrency(value);
  if (parsed.price === null) return null;
  if (parsed.price <= 0 || parsed.price < 1 || parsed.price > 100000) return null;
  return {
    price: parsed.price,
    currency: parsed.currency,
    source,
    confidence,
    method,
  };
};

const pickBestCandidate = (candidates) => {
  const ranked = (candidates || [])
    .filter(Boolean)
    .sort((a, b) => {
      const conf = (CONFIDENCE_SCORE[b.confidence] || 0) - (CONFIDENCE_SCORE[a.confidence] || 0);
      if (conf !== 0) return conf;
      return a.price - b.price;
    });
  return ranked[0] || null;
};

const shouldUseConfidenceForAlerts = (confidence) => {
  return (CONFIDENCE_SCORE[confidence] || 0) >= (CONFIDENCE_SCORE[SCRAPE_MIN_CONFIDENCE] || 2);
};

const maybeGetCachedPrice = (productUrl) => {
  const cached = priceCache.get(productUrl);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    priceCache.delete(productUrl);
    return null;
  }
  return cached.value;
};

const cachePriceResult = (productUrl, value) => {
  priceCache.set(productUrl, { value, expiresAt: Date.now() + CACHE_TTL_MS });
};

const waitForDomainRateLimit = async (hostname) => {
  if (!hostname) return;
  const lastAt = domainLastRequestAt.get(hostname) || 0;
  const elapsed = Date.now() - lastAt;
  if (elapsed < DOMAIN_MIN_INTERVAL_MS) {
    await sleep(DOMAIN_MIN_INTERVAL_MS - elapsed);
  }
  domainLastRequestAt.set(hostname, Date.now());
};

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const fetchWithRetries = async (url, options = {}) => {
  let lastStatus = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      lastStatus = response.status;
      if (response.status === 429 || response.status >= 500) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      return { response, fetchStatus: response.status, fetchAttempts: attempt + 1 };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  return {
    response: null,
    fetchStatus: lastStatus,
    fetchAttempts: 3,
    error: lastError?.message || "request_failed",
  };
};

const collectJsonLdPrices = (html) => {
  const prices = [];
  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  const pushValue = (value, source = "jsonld") => {
    const candidate = normalizeCandidate({
      value,
      source,
      confidence: "high",
      method: "jsonld",
    });
    if (candidate) prices.push(candidate);
  };

  const collectFromNode = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(collectFromNode);
      return;
    }
    if (typeof node !== "object") return;
    pushValue(node.price, "jsonld.price");
    pushValue(node.lowPrice, "jsonld.lowPrice");
    pushValue(node.highPrice, "jsonld.highPrice");
    if (node.priceSpecification) collectFromNode(node.priceSpecification);
    if (node.offers) collectFromNode(node.offers);
    if (node["@graph"]) collectFromNode(node["@graph"]);
  };

  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      collectFromNode(JSON.parse(body));
    } catch (error) {
      // ignore invalid JSON-LD blocks
    }
  }
  return prices;
};

const extractHtmlCandidates = (html, hostname) => {
  const candidates = [];
  const pushCandidate = (value, source, confidence, method) => {
    const candidate = normalizeCandidate({ value, source, confidence, method });
    if (candidate) candidates.push(candidate);
  };

  const metaPatterns = [
    {
      source: "meta.product_price_amount",
      regex:
        /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
    },
    {
      source: "meta.og_price_amount",
      regex: /<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["']/i,
    },
    {
      source: "meta.itemprop_price",
      regex: /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
    },
  ];
  for (const entry of metaPatterns) {
    pushCandidate(html.match(entry.regex)?.[1], entry.source, "high", "meta");
  }

  collectJsonLdPrices(html).forEach((candidate) => candidates.push(candidate));

  const scriptPatterns = [
    { source: "script.salePrice", regex: /"salePrice"\s*:\s*"([^"]+)"/gi },
    { source: "script.currentPrice", regex: /"currentPrice"\s*:\s*"([^"]+)"/gi },
    { source: "script.price", regex: /"price"\s*:\s*"([^"]+)"/gi },
    { source: "script.price_numeric", regex: /"price"\s*:\s*([0-9]+(?:\.[0-9]{1,2})?)/gi },
    { source: "script.amount", regex: /"amount"\s*:\s*"([^"]+)"/gi },
  ];
  for (const entry of scriptPatterns) {
    let match;
    while ((match = entry.regex.exec(html)) !== null) {
      pushCandidate(match[1], entry.source, "medium", "script");
    }
  }

  const domainPatterns = [
    {
      test: (host) => host.includes("amazon."),
      source: "amazon.priceToPay",
      regex: /"priceToPay"[^}]*"amount"\s*:\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    },
    {
      test: (host) => host.includes("walmart."),
      source: "walmart.currentPrice",
      regex: /"currentPrice"[^}]*"price"\s*:\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    },
    {
      test: (host) => host.includes("target."),
      source: "target.current_retail",
      regex: /"current_retail"\s*:\s*([0-9]+(?:\.[0-9]{1,2})?)/gi,
    },
  ];
  const domainPattern = domainPatterns.find((entry) => entry.test(hostname || ""));
  if (domainPattern) {
    let match;
    while ((match = domainPattern.regex.exec(html)) !== null) {
      pushCandidate(match[1], domainPattern.source, "medium", "domain");
    }
  }

  if (candidates.length === 0) {
    const textMatches = html.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) || [];
    textMatches.forEach((entry) =>
      pushCandidate(entry, "html.regex_fallback", "low", "regex")
    );
  }

  return candidates;
};

const getCanonicalProviderPrice = async () => {
  // Reserved for direct retailer API integrations.
  return null;
};

const getZyteFallbackPrice = async ({ productUrl, hostname }) => {
  const apiKey = process.env.ZYTE_API_KEY;
  if (!apiKey || !productUrl) return null;

  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const response = await fetch("https://api.zyte.com/v1/extract", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: productUrl,
      httpResponseBody: true,
      browserHtml: true,
    }),
  });

  if (!response.ok) return null;
  const payload = await response.json();
  const html = payload?.browserHtml || payload?.httpResponseBody;
  if (!html || typeof html !== "string") return null;

  const candidates = extractHtmlCandidates(html, hostname);
  const best = pickBestCandidate(candidates);
  if (!best) return null;

  return {
    price: best.price,
    currency: best.currency || null,
    confidence: best.confidence || "medium",
    source: "zyte_browser_html",
    extractMethod: "zyte",
    fetchStatus: response.status,
    htmlLength: html.length,
    priceCandidates: candidates,
  };
};

const getSerpApiPrice = async ({ title, productUrl, hostname }) => {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey || (!title && !productUrl)) return null;
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: title || productUrl,
    api_key: apiKey,
    num: "10",
  });
  const { response } = await fetchWithRetries(`${SERPAPI_URL}?${params.toString()}`);
  if (!response?.ok) return null;
  const payload = await response.json();
  const shopping = Array.isArray(payload?.shopping_results) ? payload.shopping_results : [];
  const candidates = shopping
    .map((entry) =>
      normalizeCandidate({
        value: entry.extracted_price ?? entry.price,
        source: `serpapi.${entry.source || "unknown"}`,
        confidence: "medium",
        method: "serpapi",
      })
    )
    .filter(Boolean)
    .filter((candidate, index) => {
      if (!hostname) return index < 5;
      const source = shopping[index]?.source?.toLowerCase() || "";
      return source.includes(hostname.replace("www.", ""));
    });
  const best = pickBestCandidate(candidates);
  if (!best) return null;
  return { best, candidates };
};

export const checkPriceByProductName = async ({ title, limit = 10 }) => {
  if (!title || typeof title !== "string" || !title.trim()) {
    throw new Error("title is required for price check");
  }

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY is not configured");
  }

  const params = new URLSearchParams({
    engine: "google_shopping",
    q: title.trim(),
    api_key: apiKey,
    num: String(Math.min(Math.max(limit, 1), 20)),
  });

  const { response, fetchStatus } = await fetchWithRetries(
    `${SERPAPI_URL}?${params.toString()}`
  );
  if (!response?.ok) {
    return {
      success: false,
      reason: "blocked_source",
      extractSource: "serpapi",
      fetchStatus: fetchStatus || null,
      bestPrice: null,
      candidates: [],
    };
  }

  const payload = await response.json();
  const shopping = Array.isArray(payload?.shopping_results) ? payload.shopping_results : [];
  const candidates = shopping
    .map((entry) =>
      normalizeCandidate({
        value: entry.extracted_price ?? entry.price,
        source: `serpapi.${entry.source || "unknown"}`,
        confidence: "medium",
        method: "serpapi",
      })
    )
    .filter(Boolean)
    .map((entry, index) => ({
      ...entry,
      title: shopping[index]?.title || null,
      merchant: shopping[index]?.source || null,
      link: shopping[index]?.product_link || shopping[index]?.link || null,
    }));

  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const best = sorted[0] || null;

  return {
    success: true,
    reason: best ? "ok" : "no_price_found",
    extractSource: "serpapi",
    fetchStatus: response.status,
    bestPrice: best
      ? {
          price: best.price,
          currency: best.currency,
          merchant: best.merchant,
          title: best.title,
          link: best.link,
        }
      : null,
    candidates: sorted.slice(0, 10).map((entry) => ({
      price: entry.price,
      currency: entry.currency,
      source: entry.source,
      confidence: entry.confidence,
      title: entry.title,
      merchant: entry.merchant,
      link: entry.link,
    })),
  };
};

export const scrapeCurrentPrice = async (productUrl, options = {}) => {
  if (!productUrl) {
    return {
      price: null,
      currency: null,
      confidence: "low",
      source: "missing_url",
      extractMethod: "none",
      fetchStatus: null,
      htmlLength: 0,
      priceCandidates: [],
      cacheHit: false,
    };
  }

  const cached = maybeGetCachedPrice(productUrl);
  if (cached) return { ...cached, cacheHit: true };

  let hostname = "";
  try {
    hostname = new URL(productUrl).hostname.toLowerCase();
  } catch (error) {
    return {
      price: null,
      currency: null,
      confidence: "low",
      source: "invalid_url",
      extractMethod: "none",
      fetchStatus: null,
      htmlLength: 0,
      priceCandidates: [],
      cacheHit: false,
    };
  }

  await waitForDomainRateLimit(hostname);

  const canonical = await getCanonicalProviderPrice({ productUrl, hostname, ...options });
  if (canonical?.price) {
    const result = {
      price: canonical.price,
      currency: canonical.currency || null,
      confidence: "high",
      source: canonical.source || "canonical_api",
      extractMethod: "canonical_api",
      fetchStatus: null,
      htmlLength: 0,
      priceCandidates: [canonical],
      cacheHit: false,
    };
    cachePriceResult(productUrl, result);
    return result;
  }

  const { response, fetchStatus, fetchAttempts, error } = await fetchWithRetries(productUrl, {
    headers: {
      "User-Agent": getRandomUserAgent(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Referer: `https://${hostname}`,
    },
  });

  const runSerpapiFallback = async () => {
    const serpapi = await getSerpApiPrice({
      title: options?.title,
      productUrl,
      hostname,
    });
    if (!serpapi?.best) return null;
    const result = {
      price: serpapi.best.price,
      currency: serpapi.best.currency || null,
      confidence: serpapi.best.confidence || "medium",
      source: "serpapi",
      extractMethod: "serpapi",
      fetchStatus: null,
      htmlLength: 0,
      priceCandidates: serpapi.candidates || [serpapi.best],
      cacheHit: false,
    };
    cachePriceResult(productUrl, result);
    return result;
  };

  const maybeRunZyteFallback = async (reason) => {
    const zyteResult = await getZyteFallbackPrice({ productUrl, hostname });
    if (zyteResult?.price !== null && zyteResult?.price !== undefined) {
      const result = {
        ...zyteResult,
        cacheHit: false,
      };
      cachePriceResult(productUrl, result);
      return result;
    }
    return {
      price: null,
      currency: null,
      confidence: "low",
      source: reason === "blocked" ? "blocked_source" : "html.none",
      extractMethod: "zyte",
      fetchStatus: fetchStatus || null,
      fetchAttempts: fetchAttempts || 0,
      htmlLength: 0,
      priceCandidates: [],
      cacheHit: false,
    };
  };

  if (!response?.ok) {
    // Retry via rendered fallback only for blocked/auth failures.
    if (fetchStatus === 401 || fetchStatus === 403) {
      const zyte = await maybeRunZyteFallback("blocked");
      if (zyte.price !== null) return zyte;
      const serpResult = await runSerpapiFallback();
      if (serpResult) return serpResult;
      return zyte;
    }
    const serpResult = await runSerpapiFallback();
    if (serpResult) return serpResult;
    return {
      price: null,
      currency: null,
      confidence: "low",
      source: "http_fetch_failed",
      extractMethod: "html",
      fetchStatus: fetchStatus || null,
      fetchAttempts: fetchAttempts || 0,
      htmlLength: 0,
      priceCandidates: [],
      error: error || null,
      cacheHit: false,
    };
  }

  const html = await response.text();
  const candidates = extractHtmlCandidates(html, hostname);
  const best = pickBestCandidate(candidates);
  const htmlResult = {
    price: best?.price ?? null,
    currency: best?.currency || null,
    confidence: best?.confidence || "low",
    source: best?.source || "html.none",
    extractMethod: best?.method || "html",
    fetchStatus: response.status,
    fetchAttempts: fetchAttempts || 1,
    htmlLength: html.length,
    priceCandidates: candidates,
    cacheHit: false,
  };
  if (htmlResult.price !== null) {
    cachePriceResult(productUrl, htmlResult);
    return htmlResult;
  }

  const shouldUseZyte =
    htmlResult.fetchStatus === 401 ||
    htmlResult.fetchStatus === 403 ||
    htmlResult.htmlLength < HTML_TOO_SMALL_THRESHOLD ||
    htmlResult.price === null;
  if (shouldUseZyte) {
    const zyte = await maybeRunZyteFallback(
      htmlResult.fetchStatus === 401 || htmlResult.fetchStatus === 403
        ? "blocked"
        : "not_found"
    );
    if (zyte.price !== null) return zyte;
  }

  const serpResult = await runSerpapiFallback();
  if (serpResult) return serpResult;

  return htmlResult;
};

export const sendPriceDropPush = async ({
  expoPushToken,
  productName,
  savedPrice,
  currentPrice,
  productUrl,
}) => {
  if (!expoPushToken) {
    return { sent: false, deviceNotRegistered: false };
  }

  const payload = {
    to: expoPushToken,
    sound: "default",
    title: "Price Drop Alert!",
    body: `${productName} dropped from $${savedPrice} to $${currentPrice}!`,
    data: {
      screen: "browser",
      productUrl,
    },
  };

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return { sent: false, deviceNotRegistered: false };
  }

  const result = await response.json();
  const tickets = Array.isArray(result?.data) ? result.data : [result?.data];

  const deviceNotRegistered = tickets.some((ticket) => {
    const detailsError = ticket?.details?.error;
    const directError = ticket?.error;
    return (
      detailsError === "DeviceNotRegistered" ||
      directError === "DeviceNotRegistered"
    );
  });

  return {
    sent: true,
    deviceNotRegistered,
  };
};

export const runPriceChecksOnce = async (options = {}) => {
  const { userId } = options;
  const startedAt = new Date();
  const itemMatch = {};
  if (userId) {
    itemMatch.userId = userId;
  }

  const activeSessionUserIds = await db
    .collection("sessions")
    .distinct("userId", { status: "active" });
  const activeSessionUserIdSet = new Set(activeSessionUserIds.map(String));

  const rows = await db
    .collection("items")
    .aggregate([
      ...(userId ? [{ $match: itemMatch }] : []),
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 1,
          userId: 1,
          title: 1,
          url: 1,
          savedPrice: 1,
          currentPrice: 1,
          lastAlerted: 1,
          expoPushToken: "$user.expoPushToken",
        },
      },
    ])
    .toArray();

  const debug = [];
  let checked = 0;
  let notified = 0;

  for (const item of rows) {
    try {
      const debugEntry = {
        itemId: String(item._id),
        title: item.title || null,
        reason: null,
        currentPrice: null,
        savedPrice: parseNumericPrice(item.savedPrice),
        hoursSinceLastAlert: null,
      };

      if (!item.url) {
        debugEntry.reason = "no_price_found";
        debug.push(debugEntry);
        continue;
      }

      if (!item.expoPushToken) {
        debugEntry.reason = "push_token_missing";
        debug.push(debugEntry);
        continue;
      }

      if (!activeSessionUserIdSet.has(String(item.userId))) {
        debugEntry.reason = "no_active_sessions";
        debug.push(debugEntry);
        continue;
      }

      const priceInfo = await scrapeCurrentPrice(item.url, { title: item.title });
      debugEntry.fetchStatus = priceInfo?.fetchStatus ?? null;
      debugEntry.htmlLength = priceInfo?.htmlLength ?? 0;
      debugEntry.extractMethod = priceInfo?.extractMethod || null;
      debugEntry.extractSource = priceInfo?.source || null;
      debugEntry.confidence = priceInfo?.confidence || null;
      debugEntry.priceCandidates = (priceInfo?.priceCandidates || [])
        .slice(0, 8)
        .map((entry) => ({
          price: entry.price,
          source: entry.source,
          confidence: entry.confidence,
        }));

      const currentPrice = priceInfo?.price ?? null;
      if (currentPrice === null) {
        if (
          priceInfo?.source === "blocked_source" ||
          priceInfo?.fetchStatus === 401 ||
          priceInfo?.fetchStatus === 403
        ) {
          debugEntry.reason = "blocked_source";
        } else {
          debugEntry.reason = "no_price_found";
        }
        debug.push(debugEntry);
        continue;
      }
      debugEntry.currentPrice = currentPrice;

      const savedPrice = parseNumericPrice(item.savedPrice);
      if (savedPrice === null) {
        debugEntry.reason = "invalid_saved_price";
        debug.push(debugEntry);
        continue;
      }

      const lastAlertedMs = item.lastAlerted
        ? new Date(item.lastAlerted).getTime()
        : 0;
      const hoursSinceAlert = lastAlertedMs
        ? (Date.now() - lastAlertedMs) / (1000 * 60 * 60)
        : Number.POSITIVE_INFINITY;
      debugEntry.hoursSinceLastAlert = Number.isFinite(hoursSinceAlert)
        ? Number(hoursSinceAlert.toFixed(2))
        : null;

      const confidenceAllowed = shouldUseConfidenceForAlerts(
        priceInfo?.confidence || "low"
      );
      const shouldNotify =
        currentPrice < savedPrice &&
        hoursSinceAlert >= PRICE_ALERT_COOLDOWN_HOURS &&
        confidenceAllowed;

      const update = {
        currentPrice,
        lastCheckedAt: new Date(),
      };

      if (shouldNotify) {
        const pushResult = await sendPriceDropPush({
          expoPushToken: item.expoPushToken,
          productName: item.title || "Wishlist item",
          savedPrice,
          currentPrice,
          productUrl: item.url,
        });

        if (pushResult.deviceNotRegistered && item.userId) {
          await db.collection("users").updateOne(
            { _id: item.userId },
            {
              $unset: { expoPushToken: "" },
              $set: { pushTokenUpdatedAt: new Date() },
            }
          );
          console.log("Cleared invalid Expo token for user", String(item.userId));
          debugEntry.reason = "push_device_not_registered";
          debug.push(debugEntry);
          await db.collection("items").updateOne({ _id: item._id }, { $set: update });
          checked += 1;
          continue;
        }

        update.lastAlerted = new Date();
        notified += 1;
        debugEntry.reason = "notified";
      } else if (!confidenceAllowed) {
        debugEntry.reason = "low_confidence";
      } else if (currentPrice >= savedPrice) {
        debugEntry.reason = "not_dropped";
      } else {
        debugEntry.reason = "cooldown_active";
      }

      await db.collection("items").updateOne({ _id: item._id }, { $set: update });
      checked += 1;
      debug.push(debugEntry);
    } catch (error) {
      console.log("price-check failed", item.url, error.message);
      debug.push({
        itemId: String(item._id),
        title: item.title || null,
        reason: "exception",
        currentPrice: null,
        savedPrice: parseNumericPrice(item.savedPrice),
        hoursSinceLastAlert: null,
        error: error.message,
      });
    }

    await sleep(ITEM_DELAY_MS);
  }

  return {
    success: true,
    startedAt,
    finishedAt: new Date(),
    checked,
    notified,
    debug,
  };
};

export const startPriceCheckScheduler = () => {
  if (process.env.ENABLE_PRICE_CHECK_JOB !== "true") {
    return;
  }

  const cronExpression = process.env.PRICE_CHECK_CRON || "0 9 * * *";
  cron.schedule(cronExpression, async () => {
    console.log("Running scheduled price checks...");
    try {
      await runPriceChecksOnce();
      console.log("Scheduled price checks complete");
    } catch (error) {
      console.log("Scheduled price checks failed", error.message);
    }
  });

  console.log(`Price-check cron scheduled: ${cronExpression}`);
};

export { parseNumericPrice };
