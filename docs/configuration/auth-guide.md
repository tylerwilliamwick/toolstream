# Auth Guide

ToolStream supports four authentication types for upstream MCP servers. This guide explains how to set up each one.

---

## `type: "none"`

No authentication. Use this for servers that don't require credentials, like a local filesystem server.

```yaml
auth:
  type: "none"
```

That's it. Nothing else to configure.

---

## `type: "env"`

The server reads credentials directly from environment variables that you set before starting ToolStream. ToolStream doesn't pass any auth headers; it just makes sure those variables are present in the environment when it launches the server subprocess.

```yaml
auth:
  type: "env"
```

Set the variables in your shell before starting ToolStream:

```bash
export MY_SERVER_KEY="your-key-here"
node dist/index.js my-config.yaml
```

Or put them in a `.env` file and source it:

```bash
source .env
node dist/index.js my-config.yaml
```

Check the MCP server's documentation to find out which environment variables it expects.

---

## `type: "bearer"`

ToolStream reads a token from an environment variable and sends it as an `Authorization: Bearer <token>` header on HTTP requests to the server. For stdio servers, it passes the token as an environment variable when launching the subprocess.

```yaml
auth:
  type: "bearer"
  token_env: "GITHUB_TOKEN"
```

`token_env` is the name of the environment variable that holds your token. The token itself is never in your config file.

**Step-by-step setup:**

1. Get your API token from the service (GitHub, Slack, etc.).

2. Add it to your shell environment. The simplest way is to add it to your shell profile:

   ```bash
   # Add this line to ~/.zshrc or ~/.bash_profile
   export GITHUB_TOKEN="ghp_yourtoken1234..."
   ```

3. Reload your shell:

   ```bash
   source ~/.zshrc
   ```

4. Verify it's set:

   ```bash
   echo $GITHUB_TOKEN
   ```

   You should see your token printed.

5. Start ToolStream. It will pick up the variable automatically.

**GitHub token setup specifically:**

1. Go to GitHub Settings > Developer settings > Personal access tokens > Tokens (classic).
2. Click "Generate new token."
3. Select the scopes you need (at minimum: `repo` for private repos, `public_repo` for public only).
4. Copy the token immediately. GitHub won't show it again.
5. Set `GITHUB_TOKEN` to that value.

---

## `type: "header"`

Sends a custom HTTP header with each request to the server. Useful for servers that use non-standard auth headers like `X-API-Key`.

```yaml
auth:
  type: "header"
  header_name: "X-API-Key"
  token_env: "MY_API_KEY"
```

`header_name` is the header to send. `token_env` is the environment variable holding the value.

Set up the environment variable the same way as with `"bearer"`:

```bash
export MY_API_KEY="your-key-here"
```

---

## Keeping secrets out of config files

Never put actual token values in your config file. Always use `token_env` to point to an environment variable. This way:

- Your config file can be committed to version control safely.
- Your tokens stay in your shell environment or a `.env` file you don't commit.

If you're using a `.env` file, add it to `.gitignore`:

```
.env
```

---

## Checking that auth is working

Start ToolStream and check the startup output. If authentication is working, you should see a tool count for each server:

```
Connecting to servers...
  filesystem: connected (12 tools)
  github: connected (31 tools)
```

If auth is failing, you'll see an error like:

```
  github: connection failed (auth error - check GITHUB_TOKEN)
```

See [Troubleshooting](../troubleshooting.md) for more detail on auth errors.
