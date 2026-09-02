#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
publish_x44.py — ดึงระดับน้ำล่าสุดของสถานี X.44 แล้วเขียนเป็นไฟล์ data/x44.json
ให้เว็บแอป "น้ำจะท่วมตรงนี้สูงเท่าไหร่" อ่านไปใช้แบบอัตโนมัติ

โครงสร้างที่ออกแบบไว้
    เครื่องในศูนย์ฯ  ──(OAuth 1.0)──>  hyd-app.rid.go.th
          │
          └─ เขียน data/x44.json  ──> push ขึ้น GitHub Pages ──> ชาวบ้านเปิดดู

เหตุผลที่ต้องมีสคริปต์นี้ ไม่ให้เว็บเรียก API ตรง ๆ
  1. API ของกรมชลประทานใช้ OAuth 1.0 ซึ่งต้องใช้ Consumer Secret ในการเซ็นคำขอ
     ถ้าฝังไว้ในหน้าเว็บสาธารณะ ใครก็เปิดดูได้
  2. เว็บที่เผยแพร่บน GitHub Pages เป็น https แต่ hyd-app เป็น http
     เบราว์เซอร์จะบล็อกการเรียกข้ามแบบนี้ (mixed content)
  3. API ไม่ได้ส่งหัว CORS มาให้ เบราว์เซอร์จึงเรียกตรงไม่ได้อยู่ดี

วิธีใช้
    # 1) หาเลข StationID ของ X.44 ในทะเบียนของ API ก่อน (ทำครั้งเดียว)
    python3 publish_x44.py --find

    # 2) ตั้งค่าแล้วสั่งเขียนไฟล์
    export RID_KEY="..."           # Consumer Key ของระบบระดับน้ำ
    export RID_SECRET="..."        # Consumer Secret
    export X44_STATION_ID="123"    # เลขที่ได้จากขั้นที่ 1
    python3 publish_x44.py

    # 3) ถ้าจะให้ push ขึ้น GitHub ให้เองด้วย
    python3 publish_x44.py --git-push

    # ทางเลือก: ถ้าเครื่องนี้รัน rid_connector.py อยู่แล้ว ใช้ผ่าน proxy ได้เลย
    python3 publish_x44.py --proxy http://127.0.0.1:8765

ตั้งให้ทำงานอัตโนมัติทุก 15 นาที
    macOS / Linux : crontab -e  แล้วใส่
        */15 * * * * cd /path/to/app && /usr/bin/python3 publish_x44.py --git-push >> publish.log 2>&1
    Windows       : Task Scheduler สร้าง Basic Task ทำซ้ำทุก 15 นาที
                    Program: python  Arguments: publish_x44.py --git-push
                    Start in: โฟลเดอร์ที่วางสคริปต์
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

WL_BASE = "http://hyd-app.rid.go.th/webservice/HydroAuthenticateService.svc/"
TZ = datetime.timezone(datetime.timedelta(hours=7))
OUT_DEFAULT = os.path.join("data", "x44.json")


# ---------------------------------------------------------------- การเรียก API
def call_direct(endpoint, payload):
    """เรียก API ตรงด้วย OAuth 1.0 (ต้องมี requests + requests_oauthlib)"""
    try:
        import requests
        from requests_oauthlib import OAuth1
    except ImportError:
        sys.exit("ต้องติดตั้งไลบรารีก่อน:  pip3 install requests requests_oauthlib")

    key = os.environ.get("RID_KEY")
    secret = os.environ.get("RID_SECRET")
    if not key or not secret:
        sys.exit("ยังไม่ได้ตั้งค่า RID_KEY และ RID_SECRET")

    auth = OAuth1(key, secret, signature_type="query")
    r = requests.post(WL_BASE + endpoint, json=payload, auth=auth, timeout=45)
    r.raise_for_status()
    return r.json()


def call_proxy(proxy, path):
    """เรียกผ่าน rid_connector.py ที่รันอยู่บนเครื่องเดียวกัน"""
    with urllib.request.urlopen(proxy.rstrip("/") + path, timeout=45) as f:
        return json.loads(f.read().decode("utf-8"))


def get_stations(proxy, hydroid):
    if proxy:
        return call_proxy(proxy, "/stations?hydroid=" + urllib.parse.quote(str(hydroid)))
    return call_direct("getDailyStationList", {"hydro": {"hydroid": str(hydroid)}})


def get_hourly(proxy, station_id, day):
    if proxy:
        return call_proxy(proxy, "/hourly?stationid=%s&timestart=%s"
                          % (urllib.parse.quote(str(station_id)), urllib.parse.quote(day)))
    return call_direct("getHourlyTodayFromStationID",
                       {"hydro": {"stationid": str(station_id), "TimeStart": day}})


# ---------------------------------------------------- ค้นหา StationID ของ X.44
def find_station(proxy, hydroid):
    rows = get_stations(proxy, hydroid)
    if isinstance(rows, dict):
        rows = rows.get("d") or rows.get("data") or []
    hits = []
    for row in rows or []:
        text = " ".join(str(v) for v in row.values() if v is not None)
        if re.search(r"\bX\.?\s*44\b", text, re.I) or "หาดใหญ่ใน" in text:
            hits.append(row)
    if not hits:
        print("ไม่พบสถานีที่ตรงกับ X.44 ในทะเบียน hydroid=%s" % hydroid)
        print("ลอง hydroid อื่น หรือดูรายชื่อทั้งหมด %d รายการด้วย --dump" % len(rows or []))
        return
    print("พบ %d รายการที่น่าจะเป็น X.44 — ใช้ค่า StationID ไปตั้งใน X44_STATION_ID" % len(hits))
    for row in hits:
        print(json.dumps(row, ensure_ascii=False, indent=1))


# ------------------------------------------------------------ ดึงและแปลงข้อมูล
def extract_series(rows):
    """คืนค่ารายการ (เวลา, ระดับ) จากผลลัพธ์ที่ API ส่งมา"""
    if isinstance(rows, dict):
        rows = rows.get("d") or rows.get("data") or []
    out = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        t = None
        for k in row:
            if re.search(r"date|time|datetime", k, re.I) and row[k]:
                t = str(row[k])
                break
        v = None
        for k in row:
            if re.search(r"^wlvalues$|wl|level|value", k, re.I):
                try:
                    v = float(row[k])
                except (TypeError, ValueError):
                    v = None
                if v is not None:
                    break
        if t and v is not None:
            m = re.search(r"/Date\((\d+)", t)          # รูปแบบ .NET /Date(...)/
            if m:
                t = datetime.datetime.fromtimestamp(int(m.group(1)) / 1000, TZ).isoformat()
            out.append({"t": t, "v": round(v, 3)})
    out.sort(key=lambda p: p["t"])
    return out


def build_feed(proxy, station_id, days=2):
    today = datetime.datetime.now(TZ).date()
    series = []
    for i in range(days - 1, -1, -1):
        day = (today - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            series += extract_series(get_hourly(proxy, station_id, day))
        except Exception as exc:                       # วันที่ไม่มีข้อมูลก็ข้ามไป
            print("เตือน: ดึงข้อมูลวันที่ %s ไม่สำเร็จ (%s)" % (day, exc), file=sys.stderr)
    if not series:
        sys.exit("ไม่ได้ข้อมูลระดับน้ำเลย — ตรวจสอบ X44_STATION_ID และการเชื่อมต่อ")

    seen, uniq = set(), []
    for p in series:
        if p["t"] not in seen:
            seen.add(p["t"])
            uniq.append(p)
    uniq = uniq[-48:]                                  # เก็บย้อนหลังไม่เกิน 48 จุด

    return {
        "station": "X.44",
        "name": "บ้านหาดใหญ่ใน อ.หาดใหญ่ จ.สงขลา",
        "unit": "ม.รทก.",
        "level": uniq[-1]["v"],
        "updated": uniq[-1]["t"],
        "source": "hyd-app.rid.go.th (getHourlyTodayFromStationID)",
        "published": datetime.datetime.now(TZ).isoformat(timespec="seconds"),
        "series": uniq,
    }


def git_push(path):
    try:
        subprocess.run(["git", "add", path], check=True)
        msg = "update X.44 telemetry " + datetime.datetime.now(TZ).strftime("%Y-%m-%d %H:%M")
        r = subprocess.run(["git", "commit", "-m", msg],
                           capture_output=True, text=True)
        if r.returncode != 0 and "nothing to commit" in (r.stdout + r.stderr):
            print("ค่าไม่เปลี่ยน ไม่ต้อง commit")
            return
        subprocess.run(["git", "push"], check=True)
        print("push ขึ้น GitHub เรียบร้อย")
    except subprocess.CalledProcessError as exc:
        print("push ไม่สำเร็จ: %s" % exc, file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description="เขียนไฟล์ระดับน้ำ X.44 ให้เว็บแอปอ่าน")
    ap.add_argument("--proxy", help="ใช้ rid_connector.py ที่รันอยู่ เช่น http://127.0.0.1:8765")
    ap.add_argument("--find", action="store_true", help="ค้นหา StationID ของ X.44 ในทะเบียน")
    ap.add_argument("--hydroid", default="8", help="รหัสสำนัก/ศูนย์สำหรับค้นทะเบียน (ค่าเริ่มต้น 8)")
    ap.add_argument("--out", default=OUT_DEFAULT, help="ที่อยู่ไฟล์ผลลัพธ์")
    ap.add_argument("--days", type=int, default=2, help="ดึงย้อนหลังกี่วัน (ค่าเริ่มต้น 2)")
    ap.add_argument("--git-push", action="store_true", help="commit และ push ไฟล์ผลลัพธ์ให้เลย")
    args = ap.parse_args()

    if args.find:
        find_station(args.proxy, args.hydroid)
        return

    station_id = os.environ.get("X44_STATION_ID")
    if not station_id:
        sys.exit("ยังไม่ได้ตั้งค่า X44_STATION_ID — หาเลขได้ด้วย  python3 publish_x44.py --find")

    feed = build_feed(args.proxy, station_id, args.days)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(feed, f, ensure_ascii=False, indent=1)
    print("เขียน %s แล้ว — ระดับล่าสุด %.2f ม.รทก. เมื่อ %s"
          % (args.out, feed["level"], feed["updated"]))

    if args.git_push:
        git_push(args.out)


if __name__ == "__main__":
    main()
