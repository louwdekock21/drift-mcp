#!/usr/bin/env node
// Drift Apparel MCP server: read-only tools that let Claude answer
// stock, order and pre-order questions from the Shopify store.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getVariants, getOrders, originalStock, isLive } from "./data.js";

const server = new McpServer({ name: "drift-apparel", version: "0.1.0" });
const text = (obj) => ({
  content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
});
const source = () => (isLive() ? "live Shopify store" : "SAMPLE DATA (no Shopify credentials set)");

server.tool(
  "search_products",
  "Search products/variants by name or SKU and show price and stock on hand.",
  { query: z.string().describe("Text to match against product name, variant or SKU") },
  async ({ query }) => {
    const q = query.toLowerCase();
    const rows = (await getVariants()).filter((v) =>
      [v.product, v.variant, v.sku].some((s) => (s ?? "").toLowerCase().includes(q))
    );
    return text({ source: source(), count: rows.length, results: rows });
  }
);

server.tool(
  "low_stock",
  "List SKUs whose stock has fallen to or below a share of the original purchase order. " +
    "Drift's reorder rule is 50%: reorder from the supplier when a SKU hits half of its original PO.",
  {
    threshold_percent: z.number().min(0).max(100).default(50)
      .describe("Flag SKUs at or below this % of original PO quantity"),
  },
  async ({ threshold_percent }) => {
    const orig = originalStock();
    const flagged = [];
    const unknown = [];
    for (const v of await getVariants()) {
      if (v.status && v.status !== "ACTIVE") continue; // drafts aren't in production
      const base = orig[v.sku];
      if (!base) { unknown.push(v.sku); continue; }
      const pct = Math.round((v.inventory / base) * 100);
      if (pct <= threshold_percent)
        flagged.push({ sku: v.sku, product: v.product, variant: v.variant,
          on_hand: v.inventory, original_po: base, percent_left: pct });
    }
    flagged.sort((a, b) => a.percent_left - b.percent_left);
    return text({ source: source(), threshold_percent, reorder_now: flagged,
      skus_missing_original_po: unknown });
  }
);

server.tool(
  "recent_orders",
  "Summarise orders from the last N days: count, revenue, and each order's items.",
  { days: z.number().int().min(1).max(90).default(7) },
  async ({ days }) => {
    const orders = await getOrders(days);
    const revenue = orders.reduce((s, o) => s + o.total, 0);
    return text({ source: source(), days, order_count: orders.length,
      revenue: Math.round(revenue * 100) / 100, orders });
  }
);

server.tool(
  "preorder_summary",
  "Units ordered on variants that are currently out of stock (pre-orders), grouped by SKU, " +
    "so you know how much to include in the next supplier order.",
  { days: z.number().int().min(1).max(90).default(30) },
  async ({ days }) => {
    const bySku = {};
    for (const o of await getOrders(days))
      for (const i of o.items)
        if (i.inventory !== null && i.inventory <= 0) {
          bySku[i.sku] ??= { sku: i.sku, title: i.title, units: 0 };
          bySku[i.sku].units += i.quantity;
        }
    const rows = Object.values(bySku).sort((a, b) => b.units - a.units);
    return text({ source: source(), days,
      total_units: rows.reduce((s, r) => s + r.units, 0), by_sku: rows });
  }
);

await server.connect(new StdioServerTransport());
