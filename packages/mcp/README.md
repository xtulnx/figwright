# @figwright/mcp

> The MCP server for **[Figwright](https://github.com/awdr74100/figwright)**: a two-way Figma agent for Claude Code, Cursor, Codex, and other MCP clients.

Figwright bridges MCP clients to a Figma plugin over a local WebSocket relay, so an AI agent can both **read** your designs with high-fidelity grounding and **write** back to the canvas. No Figma paid tier required. The server exposes **138 tools** spanning reads, writes, and codebase-grounded context.

## Usage

### Local installation from this fork

This fork distributes compiled MCP tarballs through
[GitHub Releases](https://github.com/xtulnx/figwright/releases), without publishing
to npm. With Node.js 26 installed, download `figwright-mcp-vX.Y.Z.tgz` and run:

```bash
npm install --prefix /absolute/path/figwright-local /absolute/path/figwright-mcp-vX.Y.Z.tgz
```

Installation requires internet access to download runtime dependencies. Configure
your MCP client with `"command": "node"` and
`"args": ["/absolute/path/figwright-local/node_modules/@figwright/mcp/dist/index.mjs"]`.
Use the Figma plugin zip from the same release. The `npx` instructions below run
the upstream npm package instead.

### Upstream npm installation

Add it to your MCP client config (e.g. Claude Code's `.mcp.json`):

```json
{
  "mcpServers": {
    "figwright": {
      "command": "npx",
      "args": ["-y", "@figwright/mcp@latest"]
    }
  }
}
```

The server talks to the Figwright Figma plugin running in your Figma app. See the [main repository](https://github.com/awdr74100/figwright) for the full setup (installing the plugin, connecting, and the available skills).

## Requirements

- Node.js 20.19+ or 22.12+ (the server runs via `npx` as its own process, independent of your project's Node version)

## Links

- Repository & docs: https://github.com/awdr74100/figwright
- Issues: https://github.com/awdr74100/figwright/issues

## License

[MIT](https://github.com/awdr74100/figwright/blob/main/LICENSE)
