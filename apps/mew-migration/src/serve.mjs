import { createServer } from "node:http";
import { loadStore } from "./store.mjs";

// The agent surface over the migrated store, with the source-binding rule enforced structurally:
// an answer is composed ONLY of excerpts from store rows, and every excerpt carries its binding
// (note sourceId + sourceDigest). An answer with zero bindings does not soften into prose — it
// renders as UNBOUND, visibly, with machine-readable state (data-nodekit-unbound="true").
//
// There is no generative fallback and no model call here: over an empty store (the current,
// honest state — zero notes exist because zero notes were ever inventoried) every question
// renders unbound. That is the trust surface working, not failing.

const DISCLOSURE = "No notebook data has been imported — the store is empty until the owner's Ideaflow export exists. Answers cannot cite what does not exist.";

function tokenize(text) {
  return String(text).toLowerCase().split(/[^a-z0-9#+]+/).filter((token) => token.length > 1);
}

/** Deterministic retrieval: token overlap between the question and each note's text/tags. */
export function answer(store, question) {
  const queryTokens = new Set(tokenize(question));
  const matches = [];
  for (const note of store.notes) {
    const noteTokens = new Set(tokenize(note.text));
    for (const tag of store.tags.filter((t) => t.sourceId === note.sourceId)) {
      for (const token of tokenize(tag.rawToken)) noteTokens.add(token);
    }
    const overlap = [...queryTokens].filter((token) => noteTokens.has(token));
    if (overlap.length > 0) {
      matches.push({
        excerpt: note.text.slice(0, 280),
        binding: { noteId: note.sourceId, digest: note.sourceDigest },
        matchedTokens: overlap.sort(),
      });
    }
  }
  matches.sort((a, b) => b.matchedTokens.length - a.matchedTokens.length || a.binding.noteId.localeCompare(b.binding.noteId));
  const top = matches.slice(0, 5);
  return {
    question: String(question),
    bindings: top.map((m) => m.binding),
    excerpts: top,
    unbound: top.length === 0,
    ...(top.length === 0
      ? { unboundReason: store.notes.length === 0
          ? "the store holds zero notes; nothing exists to bind an answer to"
          : "no stored note matches the question; an unmatched answer would cite nothing" }
      : {}),
  };
}

function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(store, result) {
  const counts = `${store.notes.length} notes, ${store.links.length} links, ${store.tags.length} tags`;
  const body = result
    ? result.unbound
      ? `<section data-nodekit-artifact="mew-answer" data-nodekit-unbound="true"><h2>UNBOUND</h2><p>${esc(result.unboundReason)}</p><p>This surface renders no answer without a source binding (note id + digest).</p></section>`
      : `<section data-nodekit-artifact="mew-answer" data-nodekit-unbound="false">${result.excerpts
          .map((m) => `<blockquote data-note-id="${esc(m.binding.noteId)}" data-note-digest="${esc(m.binding.digest)}">${esc(m.excerpt)}</blockquote>`)
          .join("")}</section>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>mew migration — agent surface</title></head>
<body data-nodekit-artifact="mew-migration-agent-surface" data-store-notes="${store.notes.length}">
<h1>mew migration — agent surface</h1>
<p data-nodekit-artifact="mew-disclosure">${esc(DISCLOSURE)}</p>
<p data-nodekit-artifact="mew-store-counts">store: ${esc(counts)}</p>
<form action="/ask" method="get"><input name="q" placeholder="ask the notebook"><button>ask</button></form>
${body}
</body></html>`;
}

export function createApp({ dataDir = ".data" } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const store = await loadStore(dataDir);
    if (url.pathname === "/ask") {
      const q = url.searchParams.get("q") ?? "";
      const result = answer(store, q);
      if ((req.headers.accept ?? "").includes("application/json")) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(store, result));
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(store, null));
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not found" }));
  });
}

if (process.argv[1] && process.argv[1].endsWith("serve.mjs")) {
  const port = Number(process.env.PORT ?? 4174);
  createApp({ dataDir: process.env.MEW_DATA_DIR ?? ".data" }).listen(port, "127.0.0.1", () => {
    console.log(`mew agent surface listening on http://127.0.0.1:${port}`);
  });
}
