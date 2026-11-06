// Cabo Crew on Cloudflare: the app lives in ./public, this Worker serves the trip API.
//
// Every /api call needs the trip code (header x-trip-code, or ?code= for images), which is in the invite link.
// Editing a family needs that family's token (header x-family-token), which only the phone that created it holds.
//
//   GET    /api/ping                     → { ok, ai }
//   GET    /api/families                 → { families: [{ id, name, created_at, members: [{ id, name, age, pos, fig_v, fig_kind }] }] }
//   POST   /api/families                 { name, members:[{name, age}] }      → { family, token }
//   PUT    /api/families/:id             { name, members:[{id?, name, age}] } → { family }
//   DELETE /api/families/:id                                                    → { ok }
//   PUT    /api/members/:id/fig          (JPEG body, x-fig-kind: ai|phone)     → { fig_v }
//   POST   /api/members/:id/ai           (JPEG selfie)                         → the AI figurine image itself
//   GET    /api/fig/:memberId?v=&code=                                          → the stored figurine JPEG

const MAX_FAMILIES = 12;
const MAX_MEMBERS = 8;
const FIG_MAX = 900 * 1024;      // framed figurine card, ~720x960 JPEG
const PHOTO_MAX = 700 * 1024;    // selfie sent for the AI figurine
const AI_DAILY_CAP = 60;         // AI figurines per day across the whole trip: a hard ceiling on cost
const IMAGE_MODELS = ["gemini-3.1-flash-image", "gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"];
const badModels = new Set();

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
const rid = (n = 10) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ALPHA[b % ALPHA.length]).join("");
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
function toB64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (err) {
      console.error("api", req.method, url.pathname, err);
      return json({ error: "server", message: "Something went wrong. Try again." }, 500);
    }
  },
};

async function route(req, env, url) {
  const code = req.headers.get("x-trip-code") || url.searchParams.get("code") || "";
  if (!env.TRIP_CODE || code !== env.TRIP_CODE) return json({ error: "locked", message: "Open Cabo Crew from your invite link." }, 401);
  const [, a, id, b] = url.pathname.split("/").filter(Boolean);
  const M = req.method;
  if (a === "ping" && M === "GET") return json({ ok: true, ai: !!env.GEMINI_API_KEY });
  if (a === "families" && !id && M === "GET") return json({ families: await listFamilies(env) });
  if (a === "families" && !id && M === "POST") return createFamily(req, env);
  if (a === "families" && id && M === "PUT") return updateFamily(req, env, id);
  if (a === "families" && id && M === "DELETE") return deleteFamily(req, env, id);
  if (a === "members" && id && b === "fig" && M === "PUT") return putFig(req, env, id);
  if (a === "members" && id && b === "ai" && M === "POST") return aiFig(req, env, id);
  if (a === "fig" && id && M === "GET") return getFig(env, id);
  return json({ error: "notfound", message: "Not found" }, 404);
}

/* ---------------- families ---------------- */
async function listFamilies(env, onlyId) {
  const fams = onlyId
    ? (await env.DB.prepare("SELECT id, name, created_at FROM families WHERE id = ?").bind(onlyId).all()).results
    : (await env.DB.prepare("SELECT id, name, created_at FROM families ORDER BY created_at").all()).results;
  const mems = (await env.DB.prepare("SELECT id, family_id, name, age, pos, fig_v, fig_kind FROM members ORDER BY pos").all()).results;
  return fams.map((f) => ({ ...f, members: mems.filter((m) => m.family_id === f.id).map(({ family_id, ...m }) => m) }));
}

async function readBody(req) {
  const body = await req.json().catch(() => null);
  if (!body) return { error: "Send the family as JSON." };
  const name = clean(body.name, 22).replace(/^the\s+/i, "").replace(/\s+family$/i, "");
  if (!name) return { error: "Add your family name." };
  const list = Array.isArray(body.members) ? body.members : [];
  if (!list.length) return { error: "Add at least one person." };
  if (list.length > MAX_MEMBERS) return { error: `Up to ${MAX_MEMBERS} people per family.` };
  const members = [];
  for (const m of list) {
    const n = clean(m?.name, 18), age = parseInt(m?.age, 10);
    if (!n) return { error: "Every person needs a first name." };
    if (!(age >= 0 && age <= 99)) return { error: `Add an age for ${n} (0–99).` };
    members.push({ id: typeof m.id === "string" ? m.id : "", name: n, age });
  }
  return { name, members };
}

async function auth(req, env, familyId) {
  const row = await env.DB.prepare("SELECT token FROM families WHERE id = ?").bind(familyId).first();
  if (!row) return json({ error: "nofamily", message: "That family isn't on the trip anymore." }, 404);
  if (req.headers.get("x-family-token") !== row.token) return json({ error: "forbidden", message: "Only the phone that set up this family can change it." }, 403);
  return null;
}

async function createFamily(req, env) {
  const body = await readBody(req);
  if (body.error) return json({ error: "invalid", message: body.error }, 400);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM families").first("n");
  if (count >= MAX_FAMILIES) return json({ error: "full", message: "The trip is full." }, 409);
  const id = rid(10), token = rid(24), now = Date.now();
  const stmts = [env.DB.prepare("INSERT INTO families (id, name, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, body.name, token, now, now)];
  body.members.forEach((m, i) => stmts.push(env.DB.prepare("INSERT INTO members (id, family_id, name, age, pos) VALUES (?, ?, ?, ?, ?)").bind(rid(10), id, m.name, m.age, i)));
  await env.DB.batch(stmts);
  const [family] = await listFamilies(env, id);
  return json({ family, token });
}

async function updateFamily(req, env, id) {
  const denied = await auth(req, env, id);
  if (denied) return denied;
  const body = await readBody(req);
  if (body.error) return json({ error: "invalid", message: body.error }, 400);
  const existing = new Set((await env.DB.prepare("SELECT id FROM members WHERE family_id = ?").bind(id).all()).results.map((r) => r.id));
  const keep = new Set();
  const stmts = [env.DB.prepare("UPDATE families SET name = ?, updated_at = ? WHERE id = ?").bind(body.name, Date.now(), id)];
  body.members.forEach((m, i) => {
    if (existing.has(m.id)) {
      keep.add(m.id);
      stmts.push(env.DB.prepare("UPDATE members SET name = ?, age = ?, pos = ? WHERE id = ?").bind(m.name, m.age, i, m.id));
    } else {
      stmts.push(env.DB.prepare("INSERT INTO members (id, family_id, name, age, pos) VALUES (?, ?, ?, ?, ?)").bind(rid(10), id, m.name, m.age, i));
    }
  });
  for (const old of existing) if (!keep.has(old)) stmts.push(env.DB.prepare("DELETE FROM members WHERE id = ?").bind(old));
  await env.DB.batch(stmts);
  const [family] = await listFamilies(env, id);
  return json({ family });
}

async function deleteFamily(req, env, id) {
  const denied = await auth(req, env, id);
  if (denied) return denied;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM members WHERE family_id = ?").bind(id),
    env.DB.prepare("DELETE FROM families WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}

/* ---------------- figurines ---------------- */
async function memberOf(req, env, memberId) {
  const m = await env.DB.prepare("SELECT id, family_id, name, age FROM members WHERE id = ?").bind(memberId).first();
  if (!m) return { res: json({ error: "nomember", message: "That person isn't on the trip anymore." }, 404) };
  const denied = await auth(req, env, m.family_id);
  return denied ? { res: denied } : { m };
}

async function putFig(req, env, memberId) {
  const { m, res } = await memberOf(req, env, memberId);
  if (res) return res;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > FIG_MAX) return json({ error: "toobig", message: "That figurine is too big." }, 413);
  if (!isJpeg(new Uint8Array(buf))) return json({ error: "notjpeg", message: "That isn't a JPEG." }, 400);
  const kind = req.headers.get("x-fig-kind") === "ai" ? "ai" : "phone";
  await env.DB.prepare("UPDATE members SET fig = ?, fig_mime = 'image/jpeg', fig_v = fig_v + 1, fig_kind = ? WHERE id = ?").bind(buf, kind, m.id).run();
  const fig_v = await env.DB.prepare("SELECT fig_v FROM members WHERE id = ?").bind(m.id).first("fig_v");
  return json({ fig_v });
}

async function getFig(env, memberId) {
  const row = await env.DB.prepare("SELECT fig, fig_mime FROM members WHERE id = ?").bind(memberId).first();
  if (!row || !row.fig) return json({ error: "nofig", message: "No figurine yet." }, 404);
  return new Response(new Uint8Array(row.fig), {
    headers: { "content-type": row.fig_mime || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  });
}

async function aiFig(req, env, memberId) {
  const { m, res } = await memberOf(req, env, memberId);
  if (res) return res;
  if (!env.GEMINI_API_KEY) return json({ error: "nokey", message: "AI figurines aren't switched on yet." }, 503);
  const photo = new Uint8Array(await req.arrayBuffer());
  if (photo.length > PHOTO_MAX) return json({ error: "toobig", message: "That photo is too big. Try again." }, 413);
  if (!isJpeg(photo)) return json({ error: "notjpeg", message: "That doesn't look like a photo. Try another one." }, 400);
  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare("INSERT INTO budget (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n").bind(day).first("n");
  if (used > AI_DAILY_CAP) return json({ error: "cap", message: "Today's AI figurines have all been made. Try again tomorrow." }, 429);
  const r = await generateFigurine(env, photo, caboPrompt(m.age));
  if (r.error) {
    console.log("figurine failed", r.error, r.message || "");
    const message = {
      limit: "The figurine maker is busy. Wait a minute and try again.",
      busy: "The figurine maker is busy. Wait a minute and try again.",
      blocked: "That photo couldn't be used. Try a clear photo of one face, looking at the camera.",
      noimage: "That photo couldn't be used. Try a clear photo of one face, looking at the camera.",
    }[r.error] || "Something went wrong making the figurine. Try again.";
    return json({ error: r.error, message }, r.error === "limit" || r.error === "busy" ? 503 : 502);
  }
  return new Response(r.bytes, { headers: { "content-type": r.mime, "cache-control": "no-store", "x-figurine-model": r.model } });
}

// One look for everyone (same base, light and backdrop) so all 5 families' figurines belong to one set.
// Outfits depend only on age, never on a guess about the person.
function caboPrompt(age) {
  const outfit = age < 13
    ? "a bright tropical-print swim shirt, colourful board shorts and small sandals, holding a little inflatable flamingo pool ring under one arm"
    : age < 18
      ? "a relaxed oversized tropical-print short-sleeve shirt, shorts and white sneakers, sunglasses pushed up on the head"
      : "a breezy linen resort outfit in white and sand tones with a bright tropical-print accent, sandals, and sunglasses pushed up on the head";
  return [
    "Turn the person in this photo into a photorealistic, premium collectible miniature figurine (about 1/7 scale) of this exact person on a beach holiday in Cabo San Lucas, Mexico.",
    "Most important: keep the face a faithful, instantly recognizable likeness of the photo — same face shape, eyes, eyebrows, nose, lips, skin tone, hairline and hair, facial hair and glasses (if any). Do not change their skin tone, age, ethnicity or body type, and do not beautify or slim the face.",
    `Outfit: ${outfit}. Modest and family-friendly.`,
    "Pose: standing relaxed and happy, facing the camera, one hand giving a small wave. The face must be clearly visible, front-on, with nothing covering it.",
    "Expression: a warm, happy vacation smile.",
    "Material: high-end hand-painted resin with realistic fabric texture and crisp sculpted folds.",
    "The figurine stands full-body on a round display base of pale golden sand with a thin coral-orange rim, centred in the frame with a little space above the head and the whole base visible.",
    "Setting: on a sunlit white table with a softly blurred Cabo San Lucas beach behind it: turquoise water, golden sand and the famous rock arch El Arco on the horizon at golden hour. Shallow depth of field, studio product-photography lighting with a warm rim light.",
    "Only one figure. No text, letters, logos or watermark.",
  ].join("\n");
}

// One Gemini call: selfie + prompt → figurine image. Falls through the model list when a model doesn't exist
// (or refuses). Returns { bytes, mime, model } or { error: limit|network|blocked|noimage|busy|google|model }.
async function generateFigurine(env, photo, prompt) {
  const base = env.GEMINI_BASE || "https://generativelanguage.googleapis.com";
  const data = toB64(photo);
  let last = { error: "failed" };
  for (const model of IMAGE_MODELS) {
    if (badModels.has(model)) continue;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 150000);
    let res, body;
    try {
      res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data } }, { text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } },
        }),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      return { error: "network", message: String(e) };
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const cand = body?.candidates?.[0];
      const img = (cand?.content?.parts || []).filter((p) => (p.inlineData || p.inline_data) && !p.thought).pop();
      if (img) {
        const d = img.inlineData || img.inline_data;
        return { bytes: fromB64(d.data), mime: d.mimeType || d.mime_type || "image/png", model };
      }
      const why = cand?.finishReason || body?.promptFeedback?.blockReason || "noimage";
      last = { error: /SAFETY|PROHIBIT|BLOCK|RECITATION|OTHER/i.test(why) ? "blocked" : "noimage", message: why };
      continue;
    }
    const msg = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 429) return { error: "limit", message: msg };
    if (res.status === 404 || (res.status === 400 && /model|not found|not supported/i.test(msg))) { badModels.add(model); last = { error: "model", message: msg }; continue; }
    if (res.status >= 500) { last = { error: "busy", message: msg }; continue; }
    return { error: "google", message: msg };
  }
  return last;
}
