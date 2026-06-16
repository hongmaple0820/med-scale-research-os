# MCP Configurations Catalog

10 ready-to-use MCP server configurations.

## Data & Storage

| MCP | Description | Tools |
|-----|-------------|-------|
| [memory](memory/config.json) | Knowledge graph | add_entities, search_nodes |
| [filesystem](filesystem/config.json) | File operations | read_file, write_file |
| [postgres](postgres/config.json) | PostgreSQL | query, execute |
| [neon](neon/config.json) | Neon DB | create_branch, run_query |

## Development

| MCP | Description | Tools |
|-----|-------------|-------|
| [github](github/config.json) | GitHub API | create_pr, search_repos |
| [context7](context7/config.json) | Docs lookup | resolve-library-id, query-docs |

## Testing & Browser

| MCP | Description | Tools |
|-----|-------------|-------|
| [playwright](playwright/config.json) | Browser E2E | navigate, screenshot |
| [puppeteer](puppeteer/config.json) | Browser alt | navigate, screenshot |

## Utilities

| MCP | Description | Tools |
|-----|-------------|-------|
| [fetch](fetch/config.json) | Web fetching | fetch, fetch_multiple |
| [sequential-thinking](sequential-thinking/config.json) | Deep reasoning | think, branch |

## Installation

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

## Environment Variables

Some MCPs require environment variables:
- `github`: `GITHUB_TOKEN`
- `postgres`: `POSTGRES_URL`
- `neon`: `NEON_API_KEY`
