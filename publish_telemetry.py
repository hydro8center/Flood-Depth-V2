#!/usr/bin/env python3
"""ดึงระดับน้ำ X.173A, X.90 และ X.44 จาก tele127 NeonWebService.

บริการ ASMX คืนค่า DataTable XML และใช้บัญชีอ่านข้อมูลของระบบ tele127
ค่าบัญชีเริ่มต้นเป็น guest/ridview ตามคู่มือสาธารณะของกรมชลประทาน แต่สามารถ
เปลี่ยนผ่าน TELE127_USERNAME, TELE127_PASSWORD และ TELE127_TOTP ได้โดยไม่แก้โค้ด
"""

import argparse
import datetime as dt
import json
import os
import sys
import xml.etree.ElementTree as ET

TZ = dt.timezone(dt.timedelta(hours=7))
SERVICE = os.environ.get(
    "TELE127_SERVICE",
    "https://tele127.rid.go.th/NeonWebService.asmx",
).rstrip("/")
STATIONS = [
    {
        "station": "X.173A",
        "node_id": os.environ.get("X173A_NODE_ID", "678"),
        "channel_id": os.environ.get("X173A_CHANNEL_ID", "24644"),
        "name": "บ้านม่วงก็อง อ.สะเดา จ.สงขลา",
        "bank": 16.13,
    },
    {
        "station": "X.90",
        "node_id": os.environ.get("X90_NODE_ID", "674"),
        "channel_id": os.environ.get("X90_CHANNEL_ID", "24075"),
        "name": "บ้านบางศาลา อ.คลองหอยโข่ง จ.สงขลา",
        "bank": 9.53,
    },
    {
        "station": "X.44",
        "node_id": os.environ.get("X44_NODE_ID", "667"),
        "channel_id": os.environ.get("X44_CHANNEL_ID", "21457"),
        "name": "บ้านหาดใหญ่ใน อ.หาดใหญ่ จ.สงขลา",
        "bank": 7.15,
    },
]


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def api_post(method, fields):
    try:
        import requests
    except ImportError:
        sys.exit("ติดตั้งก่อน: pip install requests")

    auth = {
        "vstrUsername": os.environ.get("TELE127_USERNAME") or "guest",
        "vstrPassword": os.environ.get("TELE127_PASSWORD") or "ridview",
        "vstrTotpCode": os.environ.get("TELE127_TOTP") or "",
    }
    response = requests.post(
        f"{SERVICE}/{method}",
        data={**auth, **fields},
        headers={"User-Agent": "HatYai-Flood-Map/0.0.3"},
        timeout=(15, 60),
    )
    response.raise_for_status()
    try:
        return ET.fromstring(response.content)
    except ET.ParseError as exc:
        raise RuntimeError(f"ผลลัพธ์ {method} ไม่ใช่ XML ที่อ่านได้") from exc


def parse_time(value):
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TZ)
    else:
        parsed = parsed.astimezone(TZ)
    return parsed.isoformat()


def extract_data(root):
    points = []
    for row in root.iter():
        if local_name(row.tag) != "Neon_x0020_Data":
            continue
        values = {local_name(child.tag): (child.text or "").strip() for child in row}
        stamp = parse_time(values.get("Data_Time", ""))
        try:
            level = float(values.get("Data_Value", ""))
        except ValueError:
            continue
        if stamp:
            points.append({"t": stamp, "v": round(level, 3)})
    unique = {point["t"]: point for point in points}
    return [unique[key] for key in sorted(unique)]


def fetch_station(config, days, max_points):
    end = dt.datetime.now(TZ).replace(microsecond=0)
    start = end - dt.timedelta(days=max(1, days))
    root = api_post(
        "GetData",
        {
            "vintChannelID": str(config["channel_id"]),
            "vdteStartTime": start.replace(tzinfo=None).isoformat(),
            "vdteEndTime": end.replace(tzinfo=None).isoformat(),
            "vblnDSTAdjust": "false",
        },
    )
    series = extract_data(root)[-max_points:]
    if not series:
        raise RuntimeError(
            f"ไม่พบข้อมูล Channel {config['channel_id']} ของ {config['station']}"
        )
    level = series[-1]["v"]
    item = {
        "station": config["station"],
        "node_id": str(config["node_id"]),
        "channel_id": str(config["channel_id"]),
        "name": config["name"],
        "bank": config["bank"],
        "unit": "ม.รทก.",
        "level": level,
        "updated": series[-1]["t"],
        "series": series,
    }
    if config["station"] == "X.44":
        item["model_level"] = round(
            level + float(os.environ.get("X44_MODEL_OFFSET", "0")), 3
        )
    return item


def load_previous(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return {
            item.get("station"): item
            for item in data.get("stations", [])
            if isinstance(item, dict)
        }
    except (OSError, ValueError):
        return {}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data/telemetry.json")
    parser.add_argument("--days", type=int, default=3)
    parser.add_argument("--max-points", type=int, default=288)
    args = parser.parse_args()

    previous = load_previous(args.out)
    output, errors, success = [], {}, 0
    for config in STATIONS:
        try:
            output.append(fetch_station(config, args.days, max(2, args.max_points)))
            success += 1
        except Exception as exc:
            errors[config["station"]] = str(exc)
            old = previous.get(config["station"])
            if old:
                output.append({**old, "error": str(exc)})
            else:
                output.append(
                    {
                        "station": config["station"],
                        "node_id": str(config["node_id"]),
                        "channel_id": str(config["channel_id"]),
                        "name": config["name"],
                        "bank": config["bank"],
                        "unit": "ม.รทก.",
                        "level": None,
                        "updated": None,
                        "series": [],
                        "error": str(exc),
                    }
                )

    if not success:
        sys.exit(
            "ดึงข้อมูลทั้งสามสถานีไม่สำเร็จ: "
            + json.dumps(errors, ensure_ascii=False)
        )

    feed = {
        "schema": 3,
        "source": "tele127.rid.go.th NeonWebService.asmx/GetData",
        "published": dt.datetime.now(TZ).isoformat(timespec="seconds"),
        "status": "ok" if success == len(STATIONS) else "partial",
        "errors": errors,
        "stations": output,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    temp = args.out + ".tmp"
    with open(temp, "w", encoding="utf-8") as fh:
        json.dump(feed, fh, ensure_ascii=False, indent=2)
    os.replace(temp, args.out)
    print(f"เขียน {args.out}: สำเร็จ {success}/{len(STATIONS)} สถานี")


if __name__ == "__main__":
    main()
