// Smoke test: starts the server over stdio with the MCP client and calls every tool.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({ command: "node", args: ["src/server.js"] })
);

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("tools:", tools.join(", "));

const calls = [
  ["search_products", { query: "fairway" }],
  ["low_stock", { threshold_percent: 50 }],
  ["recent_orders", { days: 7 }],
  ["preorder_summary", { days: 30 }],
];
for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n== ${name} ${JSON.stringify(args)}\n${r.content[0].text.slice(0, 700)}`);
}
await client.close();
