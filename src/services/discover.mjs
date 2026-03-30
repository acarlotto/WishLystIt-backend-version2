const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const SERPAPI_URL = "https://serpapi.com/search.json";

const extractBase64Payload = (imageBase64) => {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return { mediaType: null, data: null };
  }

  const trimmed = imageBase64.trim();
  const dataUrlMatch = trimmed.match(/^data:(.+);base64,(.+)$/);

  if (dataUrlMatch) {
    return {
      mediaType: dataUrlMatch[1],
      data: dataUrlMatch[2],
    };
  }

  return {
    mediaType: "image/jpeg",
    data: trimmed,
  };
};

const imageUrlToBase64 = async (imageUrl) => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Unable to download image URL (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return {
    mediaType: contentType.split(";")[0],
    data: base64,
  };
};

const sanitizeArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
};

const buildSearchQuery = ({ itemType, brand, colorOrPattern, features, style }) => {
  return [itemType, brand, colorOrPattern, style, ...sanitizeArray(features)]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
};

const parsePriceValue = (rawPrice) => {
  if (typeof rawPrice === "number") return rawPrice;
  if (typeof rawPrice !== "string") return Number.POSITIVE_INFINITY;

  const normalized = rawPrice.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const resolveAnthropicModel = () => {
  const configuredModel =
    process.env.ANTHROPIC_MODEL ||
    process.env.VISION_MODEL ||
    "claude-3-5-sonnet-20241022";

  const model = String(configuredModel).trim();
  if (!model) {
    throw new Error("ANTHROPIC_MODEL is empty");
  }

  // Anthropic request IDs look like req_xxx; fail fast with a clear error.
  if (model.startsWith("req_")) {
    throw new Error(
      "Invalid ANTHROPIC_MODEL value: request IDs cannot be used as model names"
    );
  }

  return model;
};

const callAnthropicVision = async ({ imageBase64, imageUrl }) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const model = resolveAnthropicModel();
  const prompt = process.env.DISCOVER_VISION_PROMPT || `
You are a fashion product analyst. Analyze the screenshot and identify one primary clothing item.
Return ONLY valid JSON in this exact shape:
{
  "itemType": "string",
  "brand": "string|null",
  "colorOrPattern": "string|null",
  "style": "string|null",
  "features": ["string"],
  "confidence": 0-1
}
Rules:
- itemType should include audience/category when possible (for example: "women oversized denim jacket").
- brand can be null if not visible.
- features should list distinguishing attributes (for example: "cropped", "distressed", "double-breasted").
- confidence should be your confidence in this extraction.
`.trim();

  const content = [];
  if (imageBase64 || imageUrl) {
    const parsedImage = imageBase64
      ? extractBase64Payload(imageBase64)
      : await imageUrlToBase64(imageUrl);

    const { mediaType, data } = parsedImage;
    if (!mediaType || !data) {
      throw new Error("Invalid image payload");
    }

    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data,
      },
    });
  } else {
    throw new Error("Either imageBase64 or imageUrl is required");
  }

  content.push({
    type: "text",
    text: prompt,
  });

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      temperature: 0.2,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic error ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const textBlock = payload?.content?.find((part) => part.type === "text");
  if (!textBlock?.text) {
    throw new Error("Anthropic response did not contain text output");
  }

  const firstBrace = textBlock.text.indexOf("{");
  const lastBrace = textBlock.text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("Vision response did not include JSON");
  }

  const jsonText = textBlock.text.slice(firstBrace, lastBrace + 1);
  const extracted = JSON.parse(jsonText);
  const features = sanitizeArray(extracted.features);

  return {
    itemType: extracted.itemType || "",
    brand: extracted.brand || null,
    colorOrPattern: extracted.colorOrPattern || null,
    style: extracted.style || null,
    features,
    confidence:
      typeof extracted.confidence === "number" ? extracted.confidence : null,
  };
};

const searchGoogleShopping = async ({ query, limit = 20 }) => {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY is not configured");
  }

  const params = new URLSearchParams({
    engine: "google_shopping",
    q: query,
    api_key: apiKey,
    num: String(limit),
  });

  if (process.env.DISCOVER_GOOGLE_SHOPPING_LOCATION) {
    params.set("location", process.env.DISCOVER_GOOGLE_SHOPPING_LOCATION);
  }

  const response = await fetch(`${SERPAPI_URL}?${params.toString()}`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Shopping search error ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const shoppingResults = Array.isArray(payload.shopping_results)
    ? payload.shopping_results
    : [];

  const normalized = shoppingResults.map((entry) => {
    const price =
      entry.extracted_price ??
      parsePriceValue(entry.price) ??
      Number.POSITIVE_INFINITY;

    return {
      title: entry.title || null,
      merchant: entry.source || null,
      price: Number.isFinite(price) ? price : null,
      priceLabel: entry.price || null,
      currency: entry.currency || null,
      productUrl: entry.product_link || entry.link || null,
      imageUrl: entry.thumbnail || null,
    };
  });

  normalized.sort((a, b) => {
    const aPrice = typeof a.price === "number" ? a.price : Number.POSITIVE_INFINITY;
    const bPrice = typeof b.price === "number" ? b.price : Number.POSITIVE_INFINITY;
    return aPrice - bPrice;
  });

  return normalized;
};

export const discoverByImage = async ({ imageBase64, imageUrl, limit = 20 }) => {
  const identifiedItem = await callAnthropicVision({ imageBase64, imageUrl });
  const searchQuery = buildSearchQuery(identifiedItem);

  if (!searchQuery) {
    throw new Error("Unable to build search query from image analysis");
  }

  const results = await searchGoogleShopping({ query: searchQuery, limit });

  return {
    identifiedItem,
    searchQuery,
    resultCount: results.length,
    results,
  };
};
