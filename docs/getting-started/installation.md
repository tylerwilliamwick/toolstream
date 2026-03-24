# Installation

## Prerequisites

You need Node.js 20 or later. Check what you have:

```bash
node --version
```

If the output is `v20.x.x` or higher, you're set. If it's lower, or if the command isn't found, install Node.js from [nodejs.org](https://nodejs.org). Pick the LTS version.

---

## Install ToolStream

Clone the repo and install dependencies:

```bash
git clone https://github.com/your-org/toolstream.git
cd toolstream
npm install
```

Build the project:

```bash
npm run build
```

You should see output ending with something like:

```
Found 0 errors. Watching for file changes.
```

or just no errors at all. If you see TypeScript errors, check that your Node.js version is 20+.

---

## Copy the config template

```bash
cp toolstream.config.yaml my-config.yaml
```

You'll edit `my-config.yaml` in the next step. Don't edit `toolstream.config.yaml` directly; it's the reference template.

---

## First run

```bash
node dist/index.js my-config.yaml
```

You should see:

```
ToolStream starting...
Connecting to servers...
  filesystem: connected (12 tools)
Ready. Listening on stdio.
```

If you see connection errors, check the [Troubleshooting](../troubleshooting.md) guide.

---

## Next steps

- **Claude Code users:** follow [Claude Code Setup](claude-code-setup.md) to connect ToolStream to your Claude workspace.
- **Custom app developers:** read [First Config](first-config.md) to configure your servers, then [How It Works](../concepts/how-it-works.md) to understand the routing model.
