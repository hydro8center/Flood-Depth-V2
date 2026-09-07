# อัปเดต GitHub Pages รุ่น X.174

อัปโหลดไฟล์และโฟลเดอร์ทั้งหมดในชุดนี้ไปที่รากของ repository โดยให้ `index.html` อยู่ระดับบนสุดเหมือนเดิม

ไฟล์ใหม่หรือไฟล์ที่ต้องแทนของเดิมในรุ่น 0.3.0:

- `index.html`
- `forecast-model.js`
- `data/x174-unit-hydrograph.json`
- `data/x174-thiessen.geojson`
- `ref/X174_ANALYSIS_REPORT.md`
- `tests/test-forecast-model.js`
- `.gitignore`

ต้องคงโฟลเดอร์เดิม `assets/`, `data/`, `ref/`, `.github/workflows/` และไฟล์อื่นในชุดไว้ เพราะหน้าเว็บเรียกใช้ด้วย path แบบสัมพัทธ์

ไม่ต้องอัปโหลด `.DS_Store`, `__pycache__/`, ไฟล์ต้นฉบับใน Downloads หรือโฟลเดอร์ `work/x174-analysis/`

หลังอัปโหลด ให้เปิดแท็บ Actions และรอ `pages build and deployment` เป็นสีเขียว จากนั้นเปิด GitHub Pages แล้วกดรีโหลดแบบไม่ใช้ cache หากยังเห็นรุ่นเก่า

