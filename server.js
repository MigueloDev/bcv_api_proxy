require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const https = require("https");

const app = express();

const DEFAULT_CACHE_TTL_SECONDS = 2 * 60 * 60;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX = 60;

const BCV_URL = process.env.BCV_URL || "https://www.bcv.org.ve/";
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL_SECONDS);
const RATE_LIMIT_WINDOW_MS = Number(
  process.env.RATE_LIMIT_WINDOW_MS || DEFAULT_RATE_LIMIT_WINDOW_MS
);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || DEFAULT_RATE_LIMIT_MAX);

function parseAllowedDevices() {
  console.log(!process.env.ALLOWED_DEVICES);
  if (!process.env.ALLOWED_DEVICES) return null;
  try {
    console.log(JSON.parse(process.env.ALLOWED_DEVICES));
    const parsed = JSON.parse(process.env.ALLOWED_DEVICES);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (error) {
    console.log(error);
    return null;
  }
  return null;
}

function normalizeBcvNumber(value) {
  if (!value) return null;
  const cleaned = value.trim();
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  return number;
}

function extractUsdRate(html) {
  if (!html) return null;
  const match = html.match(
    /<div[^>]*id=["']dolar["'][\s\S]*?<strong>\s*([0-9.,]+)\s*<\/strong>/i
  );
  return match ? match[1] : null;
}

function extractBcvDate(html) {
  if (!html) return null;
  const spanMatch = html.match(
    /<span[^>]*class=["'][^"']*date-display-single[^"']*["'][^>]*>/i
  );
  if (!spanMatch) return null;
  const tag = spanMatch[0];
  const contentMatch = tag.match(/content=["']([^"']+)["']/i);
  return contentMatch ? contentMatch[1] : null;
}

const insecureHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

let cachedPayload = null;
let cacheExpiresAt = 0;

async function fetchBcvHtml() {
  const response = await axios.get(BCV_URL, {
    httpsAgent: insecureHttpsAgent,
    timeout: 15000,
    headers: {
      "user-agent": "bcv-proxy/1.0",
    },
  });
  return response.data;
}

const limiter = rateLimit({
  windowMs: Number.isFinite(RATE_LIMIT_WINDOW_MS) ? RATE_LIMIT_WINDOW_MS : DEFAULT_RATE_LIMIT_WINDOW_MS,
  max: Number.isFinite(RATE_LIMIT_MAX) ? RATE_LIMIT_MAX : DEFAULT_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const deviceId = req.get("x-device-id") || "";
    const forwarded = req.get("x-forwarded-for") || "";
    const ip = forwarded.split(",")[0].trim() || req.ip || "unknown";
    return `${deviceId}:${ip}`;
  },
});

app.use(limiter);

app.get(["/", "/rate"], async (req, res) => {
  const allowedDevices = parseAllowedDevices();
  if (!allowedDevices) {
    return res.status(500).json({ error: "server_not_configured" });
  }

  const deviceId = req.get("x-device-id");
  const apiKey = req.get("x-api-key");
  const expectedKey = deviceId ? allowedDevices[deviceId] : null;

  if (!deviceId || !apiKey || !expectedKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const now = Date.now();
  if (cachedPayload && cacheExpiresAt > now) {
    return res.set("x-cache", "HIT").json(cachedPayload);
  }

  try {
    const html = await fetchBcvHtml();
    const rawRate = extractUsdRate(html);
    if (!rawRate) {
      return res.status(502).json({ error: "rate_not_found" });
    }

    const numericRate = normalizeBcvNumber(rawRate);
    if (numericRate === null) {
      return res.status(502).json({ error: "rate_invalid" });
    }

    const dateContent = extractBcvDate(html);
    let parsedDate = null;
    if (dateContent) {
      const parsed = new Date(dateContent);
      if (!Number.isNaN(parsed.getTime())) {
        parsedDate = parsed.toISOString().slice(0, 10);
      }
    }

    const payload = {
      current: {
        usd: numericRate,
        eur: null,
        date: parsedDate || new Date().toISOString().slice(0, 10),
      },
    };

    cachedPayload = payload;
    const ttlSeconds = Number.isFinite(CACHE_TTL_SECONDS) && CACHE_TTL_SECONDS > 0
      ? CACHE_TTL_SECONDS
      : DEFAULT_CACHE_TTL_SECONDS;
    cacheExpiresAt = now + ttlSeconds * 1000;

    return res.set("x-cache", "MISS").json(payload);
  } catch (error) {
    return res.status(502).json({ error: "bcv_unavailable" });
  }
});

const port = Number(process.env.PORT || 3999);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`BCV proxy listening on port ${port}`);
});
