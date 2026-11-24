// Data layer: reads from the Shopify Admin GraphQL API, or falls back to
// built-in sample data when no store credentials are configured.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const API_VERSION = "2025-01";

// Load credentials from a local .env (never committed) if one exists.
try {
  process.loadEnvFile(join(here, "..", ".env"));
} catch {
  /* no .env: fall back to real environment variables or sample data */
}

const hasClientCreds = () =>
  Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);

export const isLive = () =>
  Boolean(
    process.env.SHOPIFY_STORE &&
      (process.env.SHOPIFY_ACCESS_TOKEN || hasClientCreds())
  );

// Dev Dashboard apps use the client-credentials grant: exchange the app's
// client ID + secret for a short-lived (24h) Admin API token and cache it.
let cached = { token: null, expires: 0 };
async function getToken() {
  if (process.env.SHOPIFY_ACCESS_TOKEN) return process.env.SHOPIFY_ACCESS_TOKEN;
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;
  const res = await fetch(
    `https://${process.env.SHOPIFY_STORE}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      }),
    }
  );
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  const json = await res.json();
  cached = { token: json.access_token, expires: Date.now() + (json.expires_in ?? 86400) * 1000 };
  return cached.token;
}

async function gql(query, variables = {}) {
  const url = `https://${process.env.SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": await getToken(),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

function readJson(name) {
  const p = join(here, "..", "data", name);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) : null;
}

// Original purchase-order quantity per SKU. Shopify does not store this,
// so it lives in data/original-stock.json (you edit it when a PO lands).
export function originalStock() {
  return readJson("original-stock.json") ?? {};
}

export async function getVariants() {
  if (!isLive()) return readJson("sample-variants.json");
  const data = await gql(`{
    products(first: 100) {
      nodes { title status
        variants(first: 100) { nodes { sku title price inventoryQuantity } } }
    }
  }`);
  return data.products.nodes.flatMap((p) =>
    p.variants.nodes.map((v) => ({
      product: p.title,
      status: p.status,
      variant: v.title,
      sku: v.sku,
      price: Number(v.price),
      inventory: v.inventoryQuantity,
    }))
  );
}

export async function getOrders(days) {
  if (!isLive()) {
    const cutoff = Date.now() - days * 864e5;
    return readJson("sample-orders.json").filter(
      (o) => new Date(o.createdAt).getTime() >= cutoff
    );
  }
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const data = await gql(
    `query($q: String!) {
      orders(first: 100, query: $q, sortKey: CREATED_AT, reverse: true) {
        nodes { name createdAt displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 50) { nodes { title sku quantity
            variant { inventoryQuantity } } } }
      }
    }`,
    { q: `created_at:>=${since}` }
  );
  return data.orders.nodes.map((o) => ({
    name: o.name,
    createdAt: o.createdAt,
    status: o.displayFinancialStatus,
    total: Number(o.totalPriceSet.shopMoney.amount),
    currency: o.totalPriceSet.shopMoney.currencyCode,
    items: o.lineItems.nodes.map((l) => ({
      title: l.title,
      sku: l.sku,
      quantity: l.quantity,
      inventory: l.variant?.inventoryQuantity ?? null,
    })),
  }));
}
