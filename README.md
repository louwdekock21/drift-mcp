# drift-mcp

A small, read-only [MCP](https://modelcontextprotocol.io) server that lets Claude answer stock, order and pre-order questions for a Shopify store. Built for [Drift Apparel](https://driftapparel.co.za), a premium golf-apparel brand I run, to take the manual stock check out of supplier reordering before the first production run lands.

## The problem it solves

Drift orders stock from a supplier in limited production runs, and the reorder rule I set is simple: **reorder a SKU when it falls to 50% of its original purchase order**. Lead times are long, so missing that moment means stock-outs while ad spend keeps running. Checking this by hand means opening Shopify, copying inventory counts and comparing them to the original PO. With this server I can ask Claude instead:

> "Which SKUs do I need to reorder?"
> "How many pre-orders are waiting on out-of-stock sizes?"
> "How did the last 7 days of orders look?"

## Tools

| Tool | What it does |
|---|---|
| `search_products` | Find products/variants by name or SKU, with price and stock on hand |
| `low_stock` | SKUs at or below a % of their original PO (default 50%), lowest first |
| `recent_orders` | Order count, revenue and line items for the last N days |
| `preorder_summary` | Units ordered on out-of-stock variants, grouped by SKU, to size the next supplier order |

All tools are **read-only**. No tool can change products, inventory or orders.

## Stack

Node.js 20, the official `@modelcontextprotocol/sdk` (stdio transport), `zod` for tool input schemas, and the Shopify Admin GraphQL API. No other dependencies.

## Run it

```bash
npm install
npm test        # starts the server and calls every tool through an MCP client
```

With no credentials, the server runs on **built-in sample data** and says so in every response (`"source": "SAMPLE DATA"`). To use a real store, create an app in the Shopify Dev Dashboard with **read-only** scopes (`read_products`, `read_inventory`, `read_orders`), install it on your store, and put its credentials in a local `.env` (see `.env.example`):

```
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
```

The server exchanges these for a short-lived Admin API token (client-credentials grant) and refreshes it automatically. A static `SHOPIFY_ACCESS_TOKEN` also works.

Set `DRIFT_SAMPLE=1` to force the sample data even when credentials are present (useful for demos). The sample data uses Drift's real product and SKU names with made-up stock levels and orders.

Original PO quantities live in `data/original-stock.json` (Shopify doesn't store them). They are currently a planned 20 units per active SKU, not a confirmed order; update the file when a PO lands. Draft products are ignored by `low_stock`.

### Use it with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "drift": {
      "command": "node",
      "args": ["C:/path/to/drift-mcp/src/server.js"],
      "env": {
        "SHOPIFY_STORE": "your-store.myshopify.com",
        "SHOPIFY_CLIENT_ID": "...",
        "SHOPIFY_CLIENT_SECRET": "..."
      }
    }
  }
}
```

## Design choices

- **Read-only by design.** An assistant that can edit a live store is a risk I don't need for this problem. Writes could come later behind explicit confirmation.
- **Rules live in the tool, not the prompt.** The 50% reorder rule is in code, so the answer is the same every time instead of depending on how Claude is asked.
- **Honest fallback.** Sample data is clearly labelled in every response so a demo can never be mistaken for real numbers.
- **Original PO in a plain JSON file.** Simple and visible, and good enough for one store. A Shopify metafield would be the next step.

## Limitations / what I'd do differently

- The pre-order logic treats any ordered variant with zero or negative stock as a pre-order. A product tag or inventory policy check would be more precise.
- Pagination is capped at 100 products and 100 orders. Fine for a small catalogue, not for a large one.
- No caching or rate-limit handling yet.

## Status

Verified against the live Drift Apparel store (products, prices and inventory read correctly) and against sample data, with an automated smoke test. The store has no stock or orders yet, so the order and pre-order tools have only been exercised on sample data.
