import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { DEFAULT_CONFIG } from "@/lib/default-config";
import { dayKey } from "@/lib/economy";
import { GAME_IDS, type AnnouncementCategory, type FeedbackStatus } from "@/lib/types";
import {
  getStore,
  hashPassword,
  newId,
  pushInbox,
  sanitizeConfig,
  str,
  verifyPassword,
} from "@/lib/server/store";

type Ctx = { params: Promise<{ action: string }> };

const COOKIE = "cg_admin";
const SESSION_MS = 8 * 3600_000;
const CODE_MS = 10 * 60_000;

const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const normEmail = (v: unknown) => str(v, 120).toLowerCase();

// Sessions and codes are signed rather than stored, so they work even when
// requests are served by different server instances.
function secret(): string | null {
  return (
    process.env.ADMIN_SETUP_KEY ||
    process.env.RESEND_API_KEY ||
    (process.env.NODE_ENV !== "production" ? "city-games-dev-secret" : null)
  );
}

const sign = (data: string) => {
  const key = secret();
  return key ? createHmac("sha256", key).update(data).digest("hex") : "";
};

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function codeFor(email: string, window: number): string {
  const hex = sign(`code|${email}|${window}`);
  return String(parseInt(hex.slice(0, 10), 16) % 1_000_000).padStart(6, "0");
}

function codeValid(email: string, code: string): boolean {
  const w = Math.floor(Date.now() / CODE_MS);
  return safeEqual(code, codeFor(email, w)) || safeEqual(code, codeFor(email, w - 1));
}

function setupKeyMatches(value: unknown): boolean {
  const key = process.env.ADMIN_SETUP_KEY;
  return Boolean(key) && typeof value === "string" && safeEqual(value, key as string);
}

async function sessionEmail(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const [mail, exp, sig] = token.split("|");
  if (!mail || !exp || !sig) return null;
  if (!safeEqual(sig, sign(`session|${mail}|${exp}`))) return null;
  if (Number(exp) < Date.now()) return null;
  return getStore().admins.has(mail) ? mail : null;
}

async function startSession(email: string) {
  const exp = Date.now() + SESSION_MS;
  const token = `${email}|${exp}|${sign(`session|${email}|${exp}`)}`;
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

let lastMailError = "";

async function sendCode(email: string, code: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  lastMailError = "";
  if (!key) {
    lastMailError = "RESEND_API_KEY missing";
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ADMIN_MAIL_FROM ?? "City's Games <onboarding@resend.dev>",
        to: [email],
        subject: "City's Games(2) verification code",
        text: `Your verification code is ${code}. It expires in 10 minutes.`,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      lastMailError = `Resend ${res.status}: ${detail.slice(0, 200)}`;
      console.log(`[admin] mail failed -> ${lastMailError}`);
    }
    return res.ok;
  } catch (e) {
    lastMailError = e instanceof Error ? e.message : "network error";
    return false;
  }
}

function checkRate(email: string): boolean {
  const s = getStore();
  const rec = s.loginFails.get(email);
  if (!rec || rec.reset < Date.now()) return true;
  return rec.count < 8;
}

function noteFail(email: string) {
  const s = getStore();
  const rec = s.loginFails.get(email);
  if (!rec || rec.reset < Date.now()) {
    s.loginFails.set(email, { count: 1, reset: Date.now() + 15 * 60_000 });
  } else {
    rec.count += 1;
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  const store = getStore();
  const email = await sessionEmail();

  if (action === "me") {
    return email ? NextResponse.json({ email }) : fail("unauthorized", 401);
  }
  if (!email) return fail("unauthorized", 401);
  const url = new URL(req.url);

  if (action === "overview") {
    const players = [...store.players.values()];
    const games = GAME_IDS.map((id) => {
      const plays = players.reduce((n, p) => n + p.gameStats[id].plays, 0);
      const passes = players.reduce((n, p) => n + p.gameStats[id].passes, 0);
      const scoreSum = players.reduce((n, p) => n + p.gameStats[id].scoreSum, 0);
      return {
        id,
        plays,
        passRate: plays ? passes / plays : 0,
        avgScore: plays ? Math.round(scoreSum / plays) : 0,
      };
    });
    const mau = new Set<string>();
    for (const set of store.activity.values()) for (const u of set) mau.add(u);
    return NextResponse.json({
      totalPlayers: players.length,
      totalPlays: players.reduce((n, p) => n + p.plays, 0),
      totalExchanges: store.exchanges.length,
      pendingExchanges: store.exchanges.filter((e) => e.status === "pending").length,
      unreadFeedback: store.feedback.filter((f) => f.status === "unread").length,
      dau: store.activity.get(dayKey())?.size ?? 0,
      mau: mau.size,
      games,
    });
  }

  if (action === "players") {
    const q = str(url.searchParams.get("q"), 60).toLowerCase();
    const rows = [...store.players.values()]
      .filter((p) => !q || p.username.toLowerCase().includes(q) || p.uid.toLowerCase().includes(q))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 200)
      .map((p) => ({
        uid: p.uid,
        username: p.username,
        registeredAt: p.registeredAt,
        lastSeen: p.lastSeen,
        points: p.points,
        tokens: p.tokens,
        items: p.items,
      }));
    return NextResponse.json({ rows });
  }

  if (action === "player") {
    const p = store.players.get(str(url.searchParams.get("uid"), 120));
    if (!p) return fail("not_found", 404);
    return NextResponse.json({ player: p });
  }

  if (action === "exchanges") {
    return NextResponse.json({
      records: [...store.exchanges].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500),
    });
  }

  if (action === "config") {
    return NextResponse.json({ config: store.config });
  }

  if (action === "announcements") {
    return NextResponse.json({
      items: [...store.announcements].sort((a, b) => b.publishAt - a.publishAt),
      now: Date.now(),
    });
  }

  if (action === "feedback") {
    return NextResponse.json({
      records: [...store.feedback].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500),
    });
  }

  if (action === "system") {
    return NextResponse.json({
      admins: [...store.admins.values()].map((a) => ({
        email: a.email,
        passwordSet: Boolean(a.hash),
        protected: a.protected,
      })),
      me: email,
      emailConfigured: Boolean(process.env.RESEND_API_KEY),
    });
  }

  return fail("not_found", 404);
}

export async function POST(req: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  const store = getStore();
  const body = await readBody(req);

  if (action === "request-code") {
    const sessionMail = await sessionEmail();
    const email = sessionMail ?? normEmail(body.email);
    const account = store.admins.get(email);
    if (!account) return NextResponse.json({ ok: true });
    if (!secret()) return fail("not_configured", 503);
    const code = codeFor(email, Math.floor(Date.now() / CODE_MS));
    const sent = await sendCode(email, code);
    if (!sent) console.log(`[admin] verification code for ${email}: ${code}`);
    const exposeCode = !sent && process.env.NODE_ENV !== "production";
    return NextResponse.json({
      ok: true,
      sent,
      mailError: sent ? undefined : lastMailError,
      devCode: exposeCode ? code : undefined,
    });
  }

  if (action === "set-password") {
    const email = (await sessionEmail()) ?? normEmail(body.email);
    const account = store.admins.get(email);
    const code = str(body.code, 12);
    const password = typeof body.password === "string" ? body.password : "";
    if (!account) return fail("invalid_code");
    if (password.length < 8 || password.length > 100) return fail("weak_password");
    if (!checkRate(email)) return fail("rate_limit", 429);
    if (!secret()) return fail("not_configured", 503);
    if (!codeValid(email, code) && !setupKeyMatches(body.code)) {
      noteFail(email);
      return fail("invalid_code");
    }
    const { salt, hash } = hashPassword(password);
    account.salt = salt;
    account.hash = hash;
    store.loginFails.delete(email);
    await startSession(email);
    return NextResponse.json({ ok: true, email });
  }

  if (action === "login") {
    const email = normEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    if (!checkRate(email)) return fail("rate_limit", 429);
    const account = store.admins.get(email);
    if (!account) {
      noteFail(email);
      return fail("not_admin", 403);
    }
    const keyLogin = setupKeyMatches(password);
    if (!keyLogin) {
      if (!account.hash || !account.salt) return fail("needs_setup");
      if (!verifyPassword(password, account.salt, account.hash)) {
        noteFail(email);
        return fail("bad_password", 401);
      }
    }
    store.loginFails.delete(email);
    await startSession(email);
    return NextResponse.json({ ok: true, email });
  }

  if (action === "logout") {
    const jar = await cookies();
    jar.delete(COOKIE);
    return NextResponse.json({ ok: true });
  }

  const email = await sessionEmail();
  if (!email) return fail("unauthorized", 401);

  if (action === "exchange-status") {
    const rec = store.exchanges.find((e) => e.id === body.id);
    if (!rec) return fail("not_found", 404);
    const status = body.status;
    if (status !== "confirmed" && status !== "rejected" && status !== "pending") {
      return fail("invalid");
    }
    if (rec.status === "confirmed") return fail("already_confirmed");
    rec.status = status;
    rec.updatedAt = Date.now();
    if (status === "confirmed") {
      pushInbox(rec.uid, { kind: "exchange", points: rec.points, tokens: rec.tokens });
    }
    return NextResponse.json({ record: rec });
  }

  if (action === "config") {
    store.config = sanitizeConfig(body.config);
    return NextResponse.json({ config: store.config });
  }

  if (action === "config-reset") {
    store.config = structuredClone(DEFAULT_CONFIG);
    return NextResponse.json({ config: store.config });
  }

  if (action === "announcement-save") {
    const cats: AnnouncementCategory[] = ["maintenance", "update", "event", "rules"];
    const category = cats.includes(body.category as AnnouncementCategory)
      ? (body.category as AnnouncementCategory)
      : "update";
    const title = {
      zh: str((body.title as { zh?: string })?.zh, 100),
      en: str((body.title as { en?: string })?.en, 100),
    };
    const text = {
      zh: str((body.body as { zh?: string })?.zh, 2000),
      en: str((body.body as { en?: string })?.en, 2000),
    };
    if (!title.zh && !title.en) return fail("invalid");
    if (!title.zh) title.zh = title.en;
    if (!title.en) title.en = title.zh;
    if (!text.zh) text.zh = text.en;
    if (!text.en) text.en = text.zh;
    const publishAt = Number.isFinite(Number(body.publishAt)) ? Number(body.publishAt) : Date.now();
    const existing = store.announcements.find((a) => a.id === body.id);
    if (existing) {
      Object.assign(existing, { title, body: text, category, publishAt });
      return NextResponse.json({ item: existing });
    }
    const item = {
      id: newId("an"),
      title,
      body: text,
      category,
      publishAt,
      offline: false,
      createdAt: Date.now(),
    };
    store.announcements.push(item);
    return NextResponse.json({ item });
  }

  if (action === "announcement-toggle") {
    const item = store.announcements.find((a) => a.id === body.id);
    if (!item) return fail("not_found", 404);
    item.offline = Boolean(body.offline);
    return NextResponse.json({ item });
  }

  if (action === "announcement-delete") {
    store.announcements = store.announcements.filter((a) => a.id !== body.id);
    return NextResponse.json({ ok: true });
  }

  if (action === "feedback-update") {
    const rec = store.feedback.find((f) => f.id === body.id);
    if (!rec) return fail("not_found", 404);
    const statuses: FeedbackStatus[] = ["unread", "processing", "replied", "closed"];
    if (statuses.includes(body.status as FeedbackStatus)) rec.status = body.status as FeedbackStatus;
    const reply = str(body.reply, 2000);
    if (reply) {
      rec.replies.push({ at: Date.now(), text: reply });
      if (!statuses.includes(body.status as FeedbackStatus)) rec.status = "replied";
    }
    return NextResponse.json({ record: rec });
  }

  if (action === "admin-add") {
    const mail = normEmail(body.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return fail("invalid");
    if (store.admins.has(mail)) return fail("exists");
    store.admins.set(mail, { email: mail, protected: false });
    return NextResponse.json({ ok: true });
  }

  if (action === "admin-remove") {
    const mail = normEmail(body.email);
    const account = store.admins.get(mail);
    if (!account) return fail("not_found", 404);
    if (account.protected || mail === email) return fail("protected");
    store.admins.delete(mail);
    return NextResponse.json({ ok: true });
  }

  return fail("not_found", 404);
}
