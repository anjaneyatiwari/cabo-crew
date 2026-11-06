// Cabo Crew on Cloudflare: the app lives in ./public, this Worker serves the trip API.
//
// Every /api call needs the trip code (header x-trip-code, or ?code= for images), which is in the invite link.
// Editing a family needs that family's token (header x-family-token), which only the phone that created it holds.
//
//   GET    /api/ping                     → { ok, ai }
//   GET    /api/families                 → { families: [{ id, name, created_at, members: [{ id, name, grp, pos, fig_v, fig_kind }] }] }
//   POST   /api/families                 { name, members:[{name, grp}] }      → { family, token }
//   PUT    /api/families/:id             { name, members:[{id?, name, grp}] } → { family }
//   grp is adult | teen | kid (no ages are stored)
//   DELETE /api/families/:id                                                    → { ok }
//   PUT    /api/members/:id/fig          (JPEG body, x-fig-kind: ai|phone)     → { fig_v }
//   POST   /api/members/:id/ai           (JPEG selfie)                         → the AI figurine image itself
//   GET    /api/fig/:memberId?v=&code=                                          → the stored figurine JPEG
//   GET    /api/plan                                                           → { items } (seeded with the default plan once)
//   POST   /api/plan                     { day, t, title, note, place, who, icon, opt } → { item }
//   PUT    /api/plan/:id                 same fields                           → { item }
//   DELETE /api/plan/:id                                                       → { ok }
//   POST   /api/plan/order               { day, ids:[...] }                    → { ok }   (reorder, or move into a day)
//   GET    /api/chat?after=<id>                                                → { messages }
//   POST   /api/chat                     { member_id, text }                   → { message }
//   POST   /api/visit                    { device }                            → { ok }   (who has opened the invite link)
//   PUT    /api/members/:id/media/:kind  (JPEG; kind photo|raw)                → { v }    original selfie / plain AI figurine
//   GET    /api/album                    (organizer only)                      → { families: [...members with fig_v, photo_v, raw_v] }
//   GET    /api/media/:memberId/:kind    (organizer only)                      → the JPEG
// Plan and chat writes need a family token; x-member-id (optional) names who did it in the chat notes.

const MAX_FAMILIES = 12;
const MAX_MEMBERS = 8;
const FIG_MAX = 900 * 1024;      // framed figurine card, ~720x960 JPEG
const PHOTO_MAX = 700 * 1024;    // selfie sent for the AI figurine
const AI_DAILY_CAP = 60;         // AI figurines per day across the whole trip: a hard ceiling on cost
const IMAGE_MODELS = ["gemini-3.1-flash-image", "gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"];
const badModels = new Set();
const GROUPS = ["adult", "teen", "kid"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
const rid = (n = 10) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ALPHA[b % ALPHA.length]).join("");
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
function toB64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

// The Gemini key secret, whatever capitalisation it was saved with (GEMINI_API_KEY, Gemini_Api_key, ...).
const geminiKey = (env) => env.GEMINI_API_KEY || Object.entries(env).find(([k, v]) => k.toUpperCase() === "GEMINI_API_KEY" && typeof v === "string")?.[1] || "";

// Everything (pages and API) needs the trip code: from the invite link (?code=), the x-trip-code header,
// or the cookie the invite link leaves behind. Without it, only a "this app is private" page is served.
const cookieCode = (req) => (req.headers.get("cookie") || "").match(/(?:^|;\s*)cc=([^;]+)/)?.[1] || "";
const LOCKED_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Private</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#0E1317;color:#ECF0F2;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#98A3AC;margin:0;max-width:30ch}</style></head>
<body><div><h1>This app is private</h1><p>Open it from the invite link you were sent.</p></div>
<script>try{var c=localStorage.getItem("cabocrew.code");if(c&&!/[?&]code=/.test(location.search))location.replace("/?code="+encodeURIComponent(c));}catch(e){}</script></body></html>`;
const PRIVATE_HEADERS = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "cache-control": "no-store" };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
    if (!url.pathname.startsWith("/api/")) {
      const code = url.searchParams.get("code") || "";
      if (!env.TRIP_CODE || (code !== env.TRIP_CODE && cookieCode(req) !== env.TRIP_CODE)) {
        return new Response(LOCKED_HTML, { status: 403, headers: { "content-type": "text/html; charset=utf-8", ...PRIVATE_HEADERS } });
      }
      const res = await env.ASSETS.fetch(req);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(PRIVATE_HEADERS)) out.headers.set(k, v);
      if (code === env.TRIP_CODE) out.headers.append("set-cookie", `cc=${env.TRIP_CODE}; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax`);
      return out;
    }
    try {
      return await route(req, env, url);
    } catch (err) {
      console.error("api", req.method, url.pathname, err);
      return json({ error: "server", message: "Something went wrong. Try again." }, 500);
    }
  },
};

async function route(req, env, url) {
  const code = req.headers.get("x-trip-code") || url.searchParams.get("code") || cookieCode(req);
  if (!env.TRIP_CODE || code !== env.TRIP_CODE) return json({ error: "locked", message: "Open Cabo Crew from your invite link." }, 401);
  const [, a, id, b] = url.pathname.split("/").filter(Boolean);
  const M = req.method;
  if (a === "ping" && M === "GET") return json({ ok: true, ai: !!geminiKey(env), owner: await isOwner(req, env) });
  if (a === "families" && !id && M === "GET") return json({ families: await listFamilies(env) });
  if (a === "families" && !id && M === "POST") return createFamily(req, env);
  if (a === "families" && id && M === "PUT") return updateFamily(req, env, id);
  if (a === "families" && id && M === "DELETE") return deleteFamily(req, env, id);
  if (a === "members" && id && b === "fig" && M === "PUT") return putFig(req, env, id);
  if (a === "members" && id && b === "ai" && M === "POST") return aiFig(req, env, id);
  if (a === "fig" && id && M === "GET") return getFig(env, id);
  if (a === "plan" && !id && M === "GET") return json({ items: await listPlan(env) });
  if (a === "plan" && !id && M === "POST") return addPlan(req, env);
  if (a === "plan" && id === "order" && M === "POST") return orderPlan(req, env);
  if (a === "plan" && id && M === "PUT") return updatePlan(req, env, id);
  if (a === "plan" && id && M === "DELETE") return deletePlan(req, env, id);
  if (a === "chat" && !id && M === "GET") return listChat(env, url);
  if (a === "chat" && !id && M === "POST") return postChat(req, env);
  if (a === "visit" && !id && M === "POST") return visit(req, env);
  if (a === "members" && id && b === "media" && M === "PUT") return putMedia(req, env, id, url.pathname.split("/").filter(Boolean)[4]);
  if (a === "album" && !id && M === "GET") return album(req, env);
  if (a === "media" && id && b && M === "GET") return getMedia(req, env, id, b);
  return json({ error: "notfound", message: "Not found" }, 404);
}

/* ---------------- families ---------------- */
async function listFamilies(env, onlyId) {
  const fams = onlyId
    ? (await env.DB.prepare("SELECT id, name, created_at FROM families WHERE id = ?").bind(onlyId).all()).results
    : (await env.DB.prepare("SELECT id, name, created_at FROM families ORDER BY created_at").all()).results;
  const mems = (await env.DB.prepare("SELECT id, family_id, name, grp, pos, fig_v, fig_kind FROM members ORDER BY pos").all()).results;
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
    const n = clean(m?.name, 18), grp = GROUPS.includes(m?.grp) ? m.grp : "adult";
    if (!n) return { error: "Every person needs a first name." };
    members.push({ id: typeof m.id === "string" ? m.id : "", name: n, grp });
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
  body.members.forEach((m, i) => stmts.push(env.DB.prepare("INSERT INTO members (id, family_id, name, age, grp, pos) VALUES (?, ?, ?, 0, ?, ?)").bind(rid(10), id, m.name, m.grp, i)));
  stmts.push(env.DB.prepare("INSERT INTO messages (family_id, member_id, name, fam, kind, text, created_at) VALUES (?, NULL, ?, ?, 'join', ?, ?)")
    .bind(id, `The ${body.name} family`, body.name, `The ${body.name} family joined the trip`, now));
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
      stmts.push(env.DB.prepare("UPDATE members SET name = ?, grp = ?, pos = ? WHERE id = ?").bind(m.name, m.grp, i, m.id));
    } else {
      stmts.push(env.DB.prepare("INSERT INTO members (id, family_id, name, age, grp, pos) VALUES (?, ?, ?, 0, ?, ?)").bind(rid(10), id, m.name, m.grp, i));
    }
  });
  for (const old of existing) if (!keep.has(old)) stmts.push(env.DB.prepare("DELETE FROM members WHERE id = ?").bind(old), env.DB.prepare("DELETE FROM media WHERE member_id = ?").bind(old));
  await env.DB.batch(stmts);
  const [family] = await listFamilies(env, id);
  return json({ family });
}

async function deleteFamily(req, env, id) {
  const denied = await auth(req, env, id);
  if (denied) return denied;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM media WHERE member_id IN (SELECT id FROM members WHERE family_id = ?)").bind(id),
    env.DB.prepare("DELETE FROM members WHERE family_id = ?").bind(id),
    env.DB.prepare("DELETE FROM families WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}

/* ---------------- figurines ---------------- */
async function memberOf(req, env, memberId) {
  const m = await env.DB.prepare("SELECT id, family_id, name, grp FROM members WHERE id = ?").bind(memberId).first();
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
  if (!geminiKey(env)) return json({ error: "nokey", message: "AI figurines aren't switched on yet." }, 503);
  const photo = new Uint8Array(await req.arrayBuffer());
  if (photo.length > PHOTO_MAX) return json({ error: "toobig", message: "That photo is too big. Try again." }, 413);
  if (!isJpeg(photo)) return json({ error: "notjpeg", message: "That doesn't look like a photo. Try another one." }, 400);
  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare("INSERT INTO budget (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n").bind(day).first("n");
  if (used > AI_DAILY_CAP) return json({ error: "cap", message: "Today's AI figurines have all been made. Try again tomorrow." }, 429);
  const look = ["f", "m"].includes(req.headers.get("x-look")) ? req.headers.get("x-look") : "auto";
  const r = await generateFigurine(env, photo, caboPrompt(m.grp, look));
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
// look: "f" | "m" chosen in the app, or "auto" = keep the gender the person presents in the photo.
const OUTFITS = {
  kid: {
    f: "a bright tropical-print swimsuit with a little ruffled cover-up skirt and small sandals, holding a small inflatable flamingo pool ring under one arm",
    m: "a bright tropical-print swim shirt, colourful board shorts and small sandals, holding a small inflatable flamingo pool ring under one arm",
  },
  teen: {
    f: "a cute tropical-print sundress or a crop-length linen top with a matching skirt, white sneakers, and sunglasses pushed up on the head",
    m: "a relaxed oversized tropical-print short-sleeve shirt, shorts and white sneakers, sunglasses pushed up on the head",
  },
  adult: {
    f: "a flowy tropical-print sundress (or an elegant linen top with a matching skirt) in white, sand and coral tones, sandals, and sunglasses pushed up on the head",
    m: "a breezy linen button-up shirt in white with a bright tropical-print accent, sand-coloured shorts, sandals, and sunglasses pushed up on the head",
  },
};
function caboPrompt(grp, look) {
  const o = OUTFITS[grp] || OUTFITS.adult;
  const who = grp === "kid" ? ["girl", "boy"] : grp === "teen" ? ["teenage girl", "teenage boy"] : ["woman", "man"];
  const identity = look === "f" ? `The person is a ${who[0]}; the figurine must clearly be a ${who[0]}.`
    : look === "m" ? `The person is a ${who[1]}; the figurine must clearly be a ${who[1]}.`
    : "Keep the person's gender exactly as it appears in the photo: a woman or girl stays a woman or girl, a man or boy stays a man or boy. Never change their gender.";
  const outfit = look === "f" ? o.f : look === "m" ? o.m
    : `dress them to match how they appear in the photo. If the person is a ${who[0]}: ${o.f}. If the person is a ${who[1]}: ${o.m}`;
  return [
    "Turn the person in this photo into a photorealistic, premium collectible miniature figurine (about 1/7 scale) of this exact person on a beach holiday in Cabo San Lucas, Mexico.",
    "Most important: keep the face a faithful, instantly recognizable likeness of the photo — same face shape, eyes, eyebrows, nose, lips, skin tone, hairline, hair length and hairstyle, facial hair, glasses and jewellery (if any). Do not change their skin tone, age, ethnicity or body type, and do not beautify or slim the face.",
    identity,
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
        headers: { "content-type": "application/json", "x-goog-api-key": geminiKey(env) },
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

/* ---------------- shared plan ---------------- */
const DAY_NAMES = ["Thu, Dec 24", "Fri, Dec 25", "Sat, Dec 26", "Sun, Dec 27", "Mon, Dec 28"];
const PLACES = ["palace", "santafe", "offsite"];
const WHO = ["", "kids", "slides", "adult"];
// [day, time, icon, title, note, place, who, optional]
const DEFAULT_PLAN = [
  [0, "Midday", "plane-landing", "Land at Los Cabos (SJD)", "The resort is about 40 km from the airport, roughly 45 minutes by road.", "offsite", "", 0],
  [0, "3:00 PM", "key-round", "Check in at Palace Cabo", "Check-in opens at 3 PM. Have a photo ID and a card ready for the front desk.", "palace", "", 0],
  [0, "4:00 PM", "waves", "First swim", "Two pools have swim-up bars, and the whirlpools are heated in winter.", "palace", "", 0],
  [0, "Evening", "sparkles", "Christmas Eve dinner", "Dinner is at Palace Cabo. Ask at check-in about the holiday program.", "palace", "", 0],
  [1, "Morning", "coffee", "Breakfast at Mar de Cortés", "Buffet with live cooking stations.", "palace", "", 0],
  [1, "10:00 AM", "droplets", "Splash Water World", "Five slides. It opens 6 days a week, so check today is one of them.", "santafe", "slides", 0],
  [1, "10:00 AM", "blocks", "RiuLand kids club", "Crafts, games and sports for the younger crew.", "santafe", "kids", 0],
  [1, "1:00 PM", "utensils", "Lunch by the pool", "La Misión (Mexican) or Torote (grill) at Santa Fe.", "santafe", "", 0],
  [1, "Evening", "utensils", "À la carte dinner", "Krystal, Misaki, Bombay, El Médano or San José. Long pants for dinner.", "palace", "", 0],
  [2, "Morning", "ship", "Boat to El Arco", "Land's End and Lover's Beach are a short boat ride away. Booked separately.", "offsite", "", 1],
  [2, "Morning", "fish", "Whale watching", "Whale season in Cabo starts in December. Booked separately.", "offsite", "", 1],
  [2, "Afternoon", "sun", "Médano Beach", "Calm, swimmable water right in front of the hotel. Water sports cost extra.", "palace", "", 0],
  [2, "Night", "party-popper", "Riu Pool Party", "Themed party at Santa Fe, 4 nights a week. Check which nights.", "santafe", "adult", 0],
  [3, "9:00 AM", "dumbbell", "RiuFit or pickleball", "Daily group workouts and 3 pickleball courts at Santa Fe.", "santafe", "", 0],
  [3, "Midday", "flower-2", "Renova Spa", "Massages and treatments. Extra cost.", "palace", "", 1],
  [3, "Sunset", "camera", "All 5 families, one photo", "Médano Beach looks out toward the Arch. Golden hour is the shot.", "palace", "", 0],
  [3, "Evening", "utensils", "Farewell dinner", "Last à la carte night at Palace Cabo.", "palace", "", 0],
  [4, "Morning", "coffee", "Last breakfast", "Mar de Cortés.", "palace", "", 0],
  [4, "11:00 AM", "bed-double", "Check out", "Ask the front desk to hold bags. Lounge 24 stays open for snacks.", "palace", "", 0],
  [4, "Afternoon", "plane-takeoff", "Head to SJD", "About 45 minutes to the airport. Aim to arrive 3 hours before an international flight.", "offsite", "", 0],
];
const PLAN_COLS = "id, day, pos, t, title, note, place, who, icon, opt";
const toItem = (r) => ({ ...r, opt: !!r.opt });

async function listPlan(env) {
  const first = await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('plan_seeded', '1') ON CONFLICT(k) DO NOTHING RETURNING k").first();
  if (first) {
    const now = Date.now(), per = {};
    await env.DB.batch(DEFAULT_PLAN.map(([day, t, icon, title, note, place, who, opt]) => {
      per[day] = (per[day] ?? -1) + 1;
      return env.DB.prepare(`INSERT INTO plan_items (${PLAN_COLS}, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(rid(10), day, per[day], t, title, note, place, who, icon, opt, now);
    }));
  }
  return (await env.DB.prepare(`SELECT ${PLAN_COLS} FROM plan_items ORDER BY day, pos`).all()).results.map(toItem);
}

async function familyOf(req, env) {
  const token = req.headers.get("x-family-token") || "";
  const fam = token && await env.DB.prepare("SELECT id, name FROM families WHERE token = ?").bind(token).first();
  if (!fam) return { res: json({ error: "forbidden", message: "Set up your family from the invite link first." }, 403) };
  const mid = req.headers.get("x-member-id") || "";
  const mem = mid && await env.DB.prepare("SELECT id, name FROM members WHERE id = ? AND family_id = ?").bind(mid, fam.id).first();
  return { fam, actor: mem ? mem.name : `The ${fam.name} family`, memberId: mem ? mem.id : null };
}

function readItem(b, partial) {
  if (!b) return { error: "Send the plan item as JSON." };
  const day = parseInt(b.day, 10);
  if (!(day >= 0 && day <= 4)) return { error: "Pick a day between Dec 24 and Dec 28." };
  const title = clean(b.title, 60);
  if (!title) return { error: "Give it a name." };
  const icon = /^[a-z0-9-]{2,24}$/.test(b.icon || "") ? b.icon : "sparkles";
  return {
    day, title, icon,
    t: clean(b.t, 16), note: clean(b.note, 220),
    place: PLACES.includes(b.place) ? b.place : "palace",
    who: WHO.includes(b.who || "") ? (b.who || "") : "",
    opt: b.opt ? 1 : 0,
  };
}

async function note(env, f, text) {
  await env.DB.prepare("INSERT INTO messages (family_id, member_id, name, fam, kind, text, created_at) VALUES (?, ?, ?, ?, 'plan', ?, ?)")
    .bind(f.fam.id, f.memberId, f.actor, f.fam.name, text, Date.now()).run();
}

async function addPlan(req, env) {
  const f = await familyOf(req, env); if (f.res) return f.res;
  const it = readItem(await req.json().catch(() => null));
  if (it.error) return json({ error: "invalid", message: it.error }, 400);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM plan_items").first("n");
  if (count >= 200) return json({ error: "full", message: "The plan is full. Remove something first." }, 409);
  const pos = (await env.DB.prepare("SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM plan_items WHERE day = ?").bind(it.day).first("p"));
  const id = rid(10);
  await env.DB.prepare(`INSERT INTO plan_items (${PLAN_COLS}, family_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, it.day, pos, it.t, it.title, it.note, it.place, it.who, it.icon, it.opt, f.fam.id, Date.now()).run();
  await note(env, f, `${f.actor} added “${it.title}” to ${DAY_NAMES[it.day]}`);
  return json({ item: toItem({ id, pos, ...it }) });
}

async function updatePlan(req, env, id) {
  const f = await familyOf(req, env); if (f.res) return f.res;
  const old = await env.DB.prepare(`SELECT ${PLAN_COLS} FROM plan_items WHERE id = ?`).bind(id).first();
  if (!old) return json({ error: "gone", message: "Someone removed that from the plan." }, 404);
  const it = readItem(await req.json().catch(() => null));
  if (it.error) return json({ error: "invalid", message: it.error }, 400);
  let pos = old.pos;
  if (it.day !== old.day) pos = await env.DB.prepare("SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM plan_items WHERE day = ?").bind(it.day).first("p");
  await env.DB.prepare("UPDATE plan_items SET day = ?, pos = ?, t = ?, title = ?, note = ?, place = ?, who = ?, icon = ?, opt = ?, updated_at = ? WHERE id = ?")
    .bind(it.day, pos, it.t, it.title, it.note, it.place, it.who, it.icon, it.opt, Date.now(), id).run();
  if (it.day !== old.day) await note(env, f, `${f.actor} moved “${it.title}” to ${DAY_NAMES[it.day]}`);
  else if (it.t !== old.t) await note(env, f, `${f.actor} changed “${it.title}” to ${it.t || "no set time"} on ${DAY_NAMES[it.day]}`);
  return json({ item: toItem({ id, pos, ...it }) });
}

async function deletePlan(req, env, id) {
  const f = await familyOf(req, env); if (f.res) return f.res;
  const old = await env.DB.prepare("SELECT title, day FROM plan_items WHERE id = ?").bind(id).first();
  if (!old) return json({ ok: true });
  await env.DB.prepare("DELETE FROM plan_items WHERE id = ?").bind(id).run();
  await note(env, f, `${f.actor} removed “${old.title}” from ${DAY_NAMES[old.day]}`);
  return json({ ok: true });
}

async function orderPlan(req, env) {
  const f = await familyOf(req, env); if (f.res) return f.res;
  const b = await req.json().catch(() => null);
  const day = parseInt(b?.day, 10);
  const ids = Array.isArray(b?.ids) ? b.ids.filter((x) => typeof x === "string").slice(0, 100) : [];
  if (!(day >= 0 && day <= 4) || !ids.length) return json({ error: "invalid", message: "Nothing to reorder." }, 400);
  const rows = (await env.DB.prepare(`SELECT id, day, title FROM plan_items WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results;
  const known = new Map(rows.map((r) => [r.id, r]));
  const now = Date.now(), stmts = [];
  ids.filter((x) => known.has(x)).forEach((x, i) => stmts.push(env.DB.prepare("UPDATE plan_items SET day = ?, pos = ?, updated_at = ? WHERE id = ?").bind(day, i, now, x)));
  if (stmts.length) await env.DB.batch(stmts);
  for (const r of rows) if (r.day !== day) await note(env, f, `${f.actor} moved “${r.title}” to ${DAY_NAMES[day]}`);
  return json({ ok: true });
}

/* ---------------- chat ---------------- */
const MSG_COLS = "id, member_id, name, fam, kind, text, created_at";
async function listChat(env, url) {
  const after = parseInt(url.searchParams.get("after") || "0", 10) || 0;
  const rows = after > 0
    ? (await env.DB.prepare(`SELECT ${MSG_COLS} FROM messages WHERE id > ? ORDER BY id LIMIT 200`).bind(after).all()).results
    : (await env.DB.prepare(`SELECT ${MSG_COLS} FROM (SELECT ${MSG_COLS} FROM messages ORDER BY id DESC LIMIT 150) ORDER BY id`).all()).results;
  return json({ messages: rows });
}

async function postChat(req, env) {
  const token = req.headers.get("x-family-token") || "";
  const fam = token && await env.DB.prepare("SELECT id, name FROM families WHERE token = ?").bind(token).first();
  if (!fam) return json({ error: "forbidden", message: "Set up your family from the invite link first." }, 403);
  const b = await req.json().catch(() => null);
  const mem = b && typeof b.member_id === "string" && await env.DB.prepare("SELECT id, name FROM members WHERE id = ? AND family_id = ?").bind(b.member_id, fam.id).first();
  if (!mem) return json({ error: "who", message: "Pick who's chatting on this phone." }, 400);
  const text = String(b.text ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, 1000);
  if (!text) return json({ error: "empty", message: "Type a message first." }, 400);
  const now = Date.now();
  const id = await env.DB.prepare("INSERT INTO messages (family_id, member_id, name, fam, kind, text, created_at) VALUES (?, ?, ?, ?, 'text', ?, ?) RETURNING id")
    .bind(fam.id, mem.id, mem.name, fam.name, text, now).first("id");
  return json({ message: { id, member_id: mem.id, name: mem.name, fam: fam.name, kind: "text", text, created_at: now } });
}

/* ---------------- visits: which phones have opened the invite link ---------------- */
function deviceKind(ua) {
  ua = ua || "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Other device";
}
async function visit(req, env) {
  const b = await req.json().catch(() => null);
  const device = typeof b?.device === "string" && /^[a-z0-9]{8,32}$/.test(b.device) ? b.device : "";
  if (!device) return json({ ok: false }, 400);
  const token = req.headers.get("x-family-token") || "";
  const fam = token ? await env.DB.prepare("SELECT id FROM families WHERE token = ?").bind(token).first("id") : null;
  const cf = req.cf || {};
  const place = [cf.city, cf.regionCode || cf.region, cf.country].filter(Boolean).join(", ").slice(0, 80);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO visits (device, family_id, first_seen, last_seen, opens, device_kind, place) VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(device) DO UPDATE SET last_seen = excluded.last_seen, opens = opens + 1, family_id = COALESCE(excluded.family_id, visits.family_id), place = excluded.place`)
    .bind(device, fam, now, now, deviceKind(req.headers.get("user-agent")), place).run();
  return json({ ok: true });
}

/* ---------------- trip album: originals + figurines, for the organizer only ---------------- */
const MEDIA_KINDS = ["photo", "raw"];
const MEDIA_MAX = 1800 * 1024;
async function isOwner(req, env) {
  const token = req.headers.get("x-family-token") || "";
  if (!token) return false;
  const owner = await env.DB.prepare("SELECT v FROM meta WHERE k = 'owner_family'").first("v");
  const fam = await env.DB.prepare("SELECT id FROM families WHERE token = ?").bind(token).first("id");
  return !!fam && fam === owner;
}
async function putMedia(req, env, memberId, kind) {
  if (!MEDIA_KINDS.includes(kind)) return json({ error: "kind", message: "Unknown photo type." }, 400);
  const { m, res } = await memberOf(req, env, memberId);
  if (res) return res;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MEDIA_MAX) return json({ error: "toobig", message: "That photo is too big." }, 413);
  if (!isJpeg(new Uint8Array(buf))) return json({ error: "notjpeg", message: "That isn't a JPEG." }, 400);
  const v = await env.DB.prepare(`INSERT INTO media (member_id, kind, mime, data, v, created_at) VALUES (?, ?, 'image/jpeg', ?, 1, ?)
    ON CONFLICT(member_id, kind) DO UPDATE SET data = excluded.data, v = media.v + 1, created_at = excluded.created_at RETURNING v`).bind(m.id, kind, buf, Date.now()).first("v");
  return json({ v });
}
async function album(req, env) {
  if (!(await isOwner(req, env))) return json({ error: "forbidden", message: "Only the trip organizer can open the album." }, 403);
  const fams = await listFamilies(env);
  const media = (await env.DB.prepare("SELECT member_id, kind, v FROM media").all()).results;
  const vOf = (id, k) => (media.find((x) => x.member_id === id && x.kind === k) || {}).v || 0;
  return json({ families: fams.map((f) => ({ id: f.id, name: f.name, members: f.members.map((mm) => ({ ...mm, photo_v: vOf(mm.id, "photo"), raw_v: vOf(mm.id, "raw") })) })) });
}
async function getMedia(req, env, memberId, kind) {
  if (!MEDIA_KINDS.includes(kind)) return json({ error: "kind" }, 400);
  if (!(await isOwner(req, env))) return json({ error: "forbidden", message: "Only the trip organizer can open the album." }, 403);
  const row = await env.DB.prepare("SELECT data, mime FROM media WHERE member_id = ? AND kind = ?").bind(memberId, kind).first();
  if (!row) return json({ error: "nomedia" }, 404);
  return new Response(new Uint8Array(row.data), { headers: { "content-type": row.mime, "cache-control": "private, no-store" } });
}
