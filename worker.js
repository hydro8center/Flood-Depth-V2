/**
 * worker.js — ตัวกลางสำหรับดึงระดับน้ำสถานี X.44 โดยไม่เปิดเผย Consumer Key/Secret
 *
 * แนวคิด: กุญแจถูกเก็บเป็น Secret ของ Cloudflare อยู่ฝั่งเซิร์ฟเวอร์
 *          เบราว์เซอร์เรียกได้เฉพาะที่อยู่นี้ และได้กลับไปแค่ตัวเลขระดับน้ำ
 *          ไม่มีทางเห็นกุญแจ ไม่ว่าจะเปิด View Source หรือดู Network
 *
 * ตัวกลางนี้แก้ปัญหาให้ครบสามข้อพร้อมกัน
 *   1. กุญแจไม่หลุด เพราะการเซ็นลายเซ็น OAuth เกิดขึ้นบนเซิร์ฟเวอร์
 *   2. เว็บเป็น https ได้ เพราะ Cloudflare ให้ https มา แล้วค่อยต่อ http ไปยัง hyd-app เอง
 *   3. ข้ามโดเมนได้ เพราะเราใส่หัว CORS ให้เอง
 *
 * ---------------------------------------------------------------- วิธีติดตั้ง
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler init hatyai-x44 --no-git          (เลือกแบบ "Hello World" worker)
 *   นำไฟล์นี้ไปแทน src/index.js
 *
 *   npx wrangler secret put RID_KEY            (วาง Consumer Key)
 *   npx wrangler secret put RID_SECRET         (วาง Consumer Secret)
 *   npx wrangler secret put X44_STATION_ID     (เลข StationID ของ X.44)
 *
 * โหมดช่วยตรวจสอบ เปิดในเบราว์เซอร์ได้เลย
 *   ?env=1        ตรวจว่าตัวแปรถูกตั้งค่าครบหรือยัง (ไม่แสดงค่าจริง)
 *   ?ping=1       ทดสอบว่าต่อไปยัง hyd-app.rid.go.th ได้หรือไม่ ทั้ง https และ http
 *   ?stations=8   ค้นหาเลข StationID ของ X.44 ในทะเบียน
 *   ?raw=1        ดูข้อมูลดิบที่ API ส่งกลับมา ใช้ตอนดึงค่าไม่ขึ้น
 *
 *   ใน wrangler.toml เพิ่ม
 *       [vars]
 *       ALLOW_ORIGIN = "https://ชื่อบัญชี.github.io"
 *
 *   wrangler deploy
 *
 * จะได้ที่อยู่แบบ https://hatyai-x44.ชื่อบัญชี.workers.dev
 * แล้วเปิดเว็บแอปด้วย  index.html?feed=https://hatyai-x44.ชื่อบัญชี.workers.dev
 *
 * หมายเหตุสำคัญ: โค้ดนี้ยังไม่ได้ทดสอบกับ API จริง เพราะผมไม่มีกุญแจ
 * กรุณาทดสอบด้วยการเปิดที่อยู่ของ Worker ในเบราว์เซอร์ก่อนนำไปใช้จริง
 * ถ้าลายเซ็นไม่ผ่านจะได้ข้อความ error กลับมาให้เห็น
 */

/* ที่อยู่ของ API — ตั้งทับได้ด้วยตัวแปร WL_BASE ในหน้า Settings ของ Worker
   ค่าเริ่มต้นใช้ https เพราะเซิร์ฟเวอร์ของกรมชลประทานเปิดพอร์ต 443 ไว้
   ส่วนพอร์ต 80 (http) อาจถูกปิด ทำให้ Cloudflare ต่อไม่ติดและคืน HTTP 522 */
const WL_BASE_DEFAULT = "https://hyd-app.rid.go.th/webservice/HydroAuthenticateService.svc/";
const WL_BASE_ALT = "http://hyd-app.rid.go.th/webservice/HydroAuthenticateService.svc/";
const CACHE_SECONDS = 300;                 // เก็บผลไว้ 5 นาที ลดภาระ API ต้นทาง

/* ------------------------------------------------- ยูทิลิตี OAuth 1.0 HMAC-SHA1 */

/** เข้ารหัสตามข้อกำหนด RFC 3986 ซึ่งเข้มกว่า encodeURIComponent ปกติ */
function pct(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function hmacSha1(keyText, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyText),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function nonce() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * สร้าง URL ที่แนบพารามิเตอร์ OAuth พร้อมลายเซ็นไว้ในสตริงคำค้น
 * ตรงกับที่ requests_oauthlib ใช้เมื่อกำหนด signature_type="query"
 */
async function signedUrl(method, baseUrl, consumerKey, consumerSecret) {
  const params = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };
  const normalized = Object.keys(params)
    .sort()
    .map((k) => pct(k) + "=" + pct(params[k]))
    .join("&");
  const base = [method.toUpperCase(), pct(baseUrl), pct(normalized)].join("&");
  const signature = await hmacSha1(pct(consumerSecret) + "&", base);
  return baseUrl + "?" + normalized + "&oauth_signature=" + pct(signature);
}

/* ------------------------------------------------------- เรียก API กรมชลประทาน */

async function callOnce(base, endpoint, payload, env) {
  const url = await signedUrl("POST", base + endpoint, env.RID_KEY, env.RID_SECRET);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const conn = [521, 522, 523, 524].includes(res.status);
    throw new Error(
      "HTTP " + res.status +
      (conn ? " — Cloudflare ต่อไปยังเซิร์ฟเวอร์ปลายทางไม่ได้ (ไม่ใช่ปัญหาของลายเซ็น)" : "")
    );
  }
  return res.json();
}

/** ลอง https ก่อน ถ้าไม่ได้จึงลอง http ให้อัตโนมัติ */
async function callRid(endpoint, payload, env) {
  const bases = env.WL_BASE ? [env.WL_BASE] : [WL_BASE_DEFAULT, WL_BASE_ALT];
  const errs = [];
  for (const base of bases) {
    try {
      return await callOnce(base, endpoint, payload, env);
    } catch (e) {
      errs.push(base.split("/")[0] + " → " + (e.message || e));
    }
  }
  throw new Error("เรียก API ไม่สำเร็จ: " + errs.join(" | "));
}

/** ดึงค่าเวลาและระดับน้ำออกจากผลลัพธ์ โดยไม่ยึดติดกับชื่อคอลัมน์ตายตัว */
function extractSeries(rows) {
  if (rows && !Array.isArray(rows)) rows = rows.d || rows.data || [];
  const out = [];
  for (const row of rows || []) {
    if (!row || typeof row !== "object") continue;
    let t = null, v = null;
    for (const k of Object.keys(row)) {
      if (t === null && /date|time/i.test(k) && row[k]) t = String(row[k]);
      if (v === null && /^wlvalues$|wl|level|value/i.test(k)) {
        const n = Number(row[k]);
        if (isFinite(n)) v = n;
      }
    }
    if (t === null || v === null) continue;
    const dotnet = t.match(/\/Date\((\d+)/);          // รูปแบบ .NET /Date(...)/
    if (dotnet) t = new Date(Number(dotnet[1])).toISOString();
    out.push({ t, v: Math.round(v * 1000) / 1000 });
  }
  out.sort((a, b) => (a.t < b.t ? -1 : 1));
  return out;
}

function bangkokDate(offsetDays) {
  const d = new Date(Date.now() + 7 * 3600e3 - (offsetDays || 0) * 86400e3);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ ตัว Worker */

export default {
  async fetch(request, env, ctx) {
    const origin = env.ALLOW_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=" + CACHE_SECONDS,
      "Content-Type": "application/json; charset=utf-8",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // ใช้แคชของ Cloudflare เพื่อไม่ให้ยิง API ต้นทางถี่เกินไป
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + "/x44", request);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const q = new URL(request.url).searchParams;

    /* โหมดตรวจสอบตัวแปร: เปิด  ...workers.dev/?env=1
       บอกเฉพาะว่ามีตัวแปรชื่อนั้นหรือไม่ และยาวกี่ตัวอักษร ไม่เปิดเผยค่าจริง */
    if (q.has("env")) {
      const report = {};
      for (const name of ["RID_KEY", "RID_SECRET", "X44_STATION_ID", "ALLOW_ORIGIN"]) {
        const v = env[name];
        report[name] = v
          ? { ตั้งค่าแล้ว: true, จำนวนตัวอักษร: String(v).length }
          : { ตั้งค่าแล้ว: false };
      }
      report["ชื่อตัวแปรทั้งหมดที่ Worker มองเห็น"] = Object.keys(env).sort();
      return new Response(JSON.stringify(report, null, 1),
        { headers: { ...cors, "Cache-Control": "no-store" } });
    }

    /* โหมดทดสอบการเชื่อมต่อ: ...workers.dev/?ping=1
       ลองต่อทั้ง https และ http เพื่อดูว่าเข้าถึงเซิร์ฟเวอร์ปลายทางได้หรือไม่
       ยังไม่แตะเรื่องลายเซ็นหรือกุญแจ ใช้แยกว่าปัญหาอยู่ที่เครือข่ายหรือที่การยืนยันตัวตน */
    if (q.has("ping")) {
      const out = {};
      for (const url of ["https://hyd-app.rid.go.th/", "http://hyd-app.rid.go.th/"]) {
        const t0 = Date.now();
        try {
          const r = await fetch(url, { method: "GET" });
          out[url] = { สถานะ: r.status, มิลลิวินาที: Date.now() - t0 };
        } catch (e) {
          out[url] = { ผิดพลาด: String(e.message || e), มิลลิวินาที: Date.now() - t0 };
        }
      }
      return new Response(JSON.stringify(out, null, 1),
        { headers: { ...cors, "Cache-Control": "no-store" } });
    }

    try {
      const missing = ["RID_KEY", "RID_SECRET"].filter((k) => !env[k]);
      if (missing.length) {
        throw new Error(
          "ยังไม่ได้ตั้งค่า " + missing.join(" และ ") +
          " — Worker มองเห็นตัวแปรเหล่านี้: [" + Object.keys(env).sort().join(", ") +
          "] ดูรายละเอียดเพิ่มที่ ?env=1"
        );
      }

      /* โหมดค้นหาเลขสถานี: เปิด  ...workers.dev/?stations=8  ในเบราว์เซอร์
         จะได้รายชื่อสถานีที่ตรงกับ X.44 พร้อมเลข StationID ที่ต้องนำไปตั้งค่า */
      if (q.has("stations")) {
        const rows = await callRid(
          "getDailyStationList",
          { hydro: { hydroid: q.get("stations") || "8" } },
          env
        );
        const list = Array.isArray(rows) ? rows : rows.d || rows.data || [];
        const hits = list.filter((r) =>
          /X\.?\s*44\b|หาดใหญ่ใน/i.test(Object.values(r).join(" "))
        );
        return new Response(
          JSON.stringify({ พบ: hits.length, ทั้งหมด: list.length, สถานีที่ตรงกับ_X44: hits }, null, 1),
          { headers: { ...cors, "Cache-Control": "no-store" } }
        );
      }

      if (!env.X44_STATION_ID) {
        throw new Error(
          "ยังไม่ได้ตั้งค่า X44_STATION_ID — หาเลขได้โดยเปิดที่อยู่นี้ต่อท้ายด้วย ?stations=8"
        );
      }

      /* โหมดดูข้อมูลดิบ: ...workers.dev/?raw=1  ใช้ตรวจว่าคอลัมน์ชื่ออะไร เวลาดึงค่าไม่ได้ */
      if (q.has("raw")) {
        const rows = await callRid(
          "getHourlyTodayFromStationID",
          { hydro: { stationid: String(env.X44_STATION_ID), TimeStart: bangkokDate(0) } },
          env
        );
        return new Response(JSON.stringify(rows, null, 1).slice(0, 4000),
          { headers: { ...cors, "Cache-Control": "no-store" } });
      }

      let series = [];
      for (const day of [bangkokDate(1), bangkokDate(0)]) {
        try {
          const rows = await callRid(
            "getHourlyTodayFromStationID",
            { hydro: { stationid: String(env.X44_STATION_ID), TimeStart: day } },
            env
          );
          series = series.concat(extractSeries(rows));
        } catch (e) {
          // วันไหนไม่มีข้อมูลก็ข้ามไป ไม่ให้ทั้งคำขอล้ม
        }
      }

      const seen = new Set();
      series = series.filter((p) => (seen.has(p.t) ? false : seen.add(p.t))).slice(-48);
      if (!series.length) {
        throw new Error(
          "เชื่อมต่อ API ได้ แต่ไม่พบค่าระดับน้ำ — ตรวจสอบว่า X44_STATION_ID ถูกต้อง " +
          "หรือดูชื่อคอลัมน์ที่ API ส่งมาด้วย ?raw=1"
        );
      }

      const body = JSON.stringify({
        station: "X.44",
        name: "บ้านหาดใหญ่ใน อ.หาดใหญ่ จ.สงขลา",
        unit: "ม.รทก.",
        level: series[series.length - 1].v,
        updated: series[series.length - 1].t,
        source: "hyd-app.rid.go.th ผ่านตัวกลาง Cloudflare Worker",
        published: new Date().toISOString(),
        series,
      });

      const res = new Response(body, { headers: cors });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (err) {
      return new Response(
        JSON.stringify({ error: String(err.message || err) }),
        { status: 502, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }
  },
};
