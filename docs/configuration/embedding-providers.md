# Embedding Providers

ToolStream converts tool descriptions and conversation text into vectors to power semantic routing. You can run this inference locally or delegate it to OpenAI's API.

---

## Local provider (default)

The local provider uses `all-MiniLM-L6-v2` via `@xenova/transformers`, which runs ONNX inference directly in Node.js. No API key, no external calls, no per-embedding cost.

**Specs:**
- Model: `all-MiniLM-L6-v2`
- Vector dimensions: 384
- First-run: downloads ~90MB model weights from Hugging Face (cached after that)
- Latency: typically under 50ms per embedding on modern hardware

**Config:**

```yaml
toolstream:
  embedding:
    provider: local
    model: all-MiniLM-L6-v2
```

This is the right choice for most setups. The model is fast enough for real-time routing and accurate enough to distinguish between tools across different domains.

---

## OpenAI provider

The OpenAI provider uses `text-embedding-3-small` by default. It produces 1536-dimensional vectors, which can improve routing quality when you have many tools with similar descriptions.

**Specs:**
- Default model: `text-embedding-3-small`
- Vector dimensions: 1536
- Requires: `OPENAI_API_KEY` environment variable or `embedding.openai_api_key` in config
- Cost: charged per token by OpenAI (embeddings are cheap; indexing 500 tools typically costs under $0.01)

**Config:**

```yaml
toolstream:
  embedding:
    provider: openai
    model: text-embedding-3-small
    openai_api_key: sk-...   # or set OPENAI_API_KEY env var
```

You can also use `text-embedding-3-large` (3072 dimensions) if you need higher fidelity:

```yaml
toolstream:
  embedding:
    provider: openai
    model: text-embedding-3-large
```

---

## Automatic fallback

If you configure `provider: openai` but the API call fails (network error, invalid key, rate limit), ToolStream falls back to the local model automatically and logs a warning:

```
[EmbeddingEngine] OpenAI embed failed, falling back to local: ...
```

The fallback happens per-call, not at startup. If OpenAI recovers, subsequent calls will use it again. During a fallback, the local model is initialized on demand if it hasn't been loaded yet.

Note: if OpenAI is your primary provider and the local model hasn't been downloaded yet, the first fallback call will take longer than usual while the model downloads.

---

## Dimension guard

Vectors from different providers aren't compatible. A 384-dimensional local vector compared against a 1536-dimensional OpenAI vector produces meaningless similarity scores.

If you switch providers after the embedding index has been built, you need to clear the old embeddings. Delete `toolstream.db` and restart; ToolStream will re-index all tools using the new provider.

The database stores each embedding alongside a `model_id` string (`local:all-MiniLM-L6-v2` or `openai:text-embedding-3-small`). If you switch providers without clearing the database, old and new vectors will have different `model_id` values but the dimension mismatch will silently corrupt routing scores. Always do a clean restart when changing providers.

---

## When to use which

**Use local** if:
- You want zero ongoing API cost
- Your tools are spread across clearly different domains (filesystem, GitHub, Jira)
- You're running in an air-gapped or offline environment after the initial model download

**Use OpenAI** if:
- You have many tools with similar descriptions (e.g., 20+ Jira tools that all mention "issue")
- Routing quality matters more than cost
- You're already paying for OpenAI API access and want slightly sharper semantic matching
