# เชื่อมโทรมาตร X.173A, X.90 และ X.44 จาก tele127

รุ่นนี้อ่านข้อมูลจาก `https://tele127.rid.go.th/NeonWebService.asmx/GetData`
ผ่าน GitHub Actions ทุก 15 นาที แล้วบันทึกผลลัพธ์สาธารณะลง
`data/telemetry.json` เพื่อให้ GitHub Pages อ่านโดยไม่เรียก Web Service จากเบราว์เซอร์

## รหัสที่ตรวจจาก NeonWebService

| สถานี | Node ID | Water-level Channel ID |
|---|---:|---:|
| X.173A บ้านม่วงก็อง | 678 | 24644 |
| X.90 บ้านบางศาลา | 674 | 24075 |
| X.44 บ้านหาดใหญ่ใน | 667 | 21457 |

ค่าเริ่มต้นของตัวอ่านข้อมูลคือบัญชีสำหรับดูข้อมูล `guest` / `ridview` ตามคู่มือ
สาธารณะของกรมชลประทาน จึงไม่ต้องใช้ `RID_KEY` และ `RID_SECRET` ของระบบเดิมแล้ว

## ไฟล์ที่ต้องอยู่ใน repository

- `index.html`
- `shelters.json`
- `data/telemetry.json`
- `data/forecast-rain-history.json` (ประวัติฝนสำหรับเติม API และฝนย้อนหลังอัตโนมัติ)
- `ref/`
- `publish_telemetry.py`
- `.github/workflows/publish-telemetry.yml`

## ตั้งค่าบน GitHub

1. ไปที่ **Settings → Actions → General → Workflow permissions**
2. เลือก **Read and write permissions** แล้วกด Save
3. เปิด **Actions → อัปเดตโทรมาตรคลองอู่ตะเภา → Run workflow**
4. รอให้งานเป็นสีเขียว แล้วเปิด `data/telemetry.json`
5. ตรวจว่า `status` เป็น `ok` และทั้งสามสถานีมี `level` กับ `updated`

ไม่จำเป็นต้องสร้าง Secret เพิ่มในกรณีที่บัญชี guest ยังใช้งานได้ หากกรมชลประทาน
เปลี่ยนบัญชี ให้สร้าง:

- Variable `TELE127_USERNAME`
- Secret `TELE127_PASSWORD`

## ตัวแปรสำหรับกรณีรหัสช่องเปลี่ยน

ปกติไม่ต้องสร้าง หากทะเบียนสถานีเปลี่ยนจึงค่อยเพิ่ม Actions Variables:

- `X173A_CHANNEL_ID`
- `X90_CHANNEL_ID`
- `X44_CHANNEL_ID`
- `X44_MODEL_OFFSET` ค่าเริ่มต้น `0`

## หมายเหตุ

- ข้อมูลจาก Channel เป็นช่วงละ 15 นาที และเก็บใน JSON ย้อนหลังไม่เกิน 288 จุด
- หน้าเว็บจะไม่ใช้ค่า X.44 ที่เก่ากว่า 24 ชั่วโมงคำนวณอัตโนมัติ
- ระดับตลิ่งติดตามของแอปใช้ X.173A = 16.13, X.90 = 9.53 และ X.44 = 7.15 ม.รทก.
- GitHub Actions อาจเริ่มช้ากว่าเวลาที่กำหนด จึงไม่ควรเป็นช่องทางเตือนภัยเพียงช่องทางเดียว
- `RID_KEY` และ `RID_SECRET` เดิมสามารถลบออกจาก GitHub Secrets ได้หลังทดสอบรุ่นนี้ผ่าน
