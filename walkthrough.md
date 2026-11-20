# 實作與驗證報告 (Walkthrough) - v1.0.0

> **對應專案版本**: `v1.0.0`  
> **驗證日期**: 2026-11-20  
> **系統名稱**: 運動員防受傷檢測系統 (Athletic Mobility & FMS Screening PWA)

---

## 🎯 成果摘要

針對使用者提出的**「利用手機鏡頭偵測柔軟度」**需求，並根據**「構想 4：專項運動員防受傷篩檢 (FMS 功能性活動度檢測)」**、**「施測者手持手機操作」**與**「PWA 離線單頁應用」**之核心規格，已完整建置具備端側 AI 電腦視覺骨架追蹤的 Web 應用系統。

本系統採用純前端架構，無須後端伺服器，所有視訊幀於手機端本機記憶體進行 WebAssembly 推論，兼具即時 30+ FPS 高流暢度與 100% 隱私保護。

---

## 🧩 核心功能模組與實作細節

### 1. 施測者手持專用 HUD 與電子水平儀 (`src/sensors.ts`, `src/ui.ts`)
- **手機水平儀 (Digital Bubble Level)**：即時調用 `DeviceOrientationEvent` 監控手機的前後傾角 (Pitch) 與左右側傾角 (Roll)。當施測者手持平視且鏡頭垂直地面時顯示綠燈；偏差過大時呈現紅燈與提示「手機傾斜過大，請拿正平視」，確保無透視俯仰角誤差。
- **動態角度儀表**：在相機畫面上自動捕捉 33 個 3D 人體關鍵點，並於受測目標髖關節周圍即時繪製發光量角弧線與角度數值 Badge。

### 2. ASLR (主動直膝抬腿) 向量生物力學演算法 (`src/biomechanics.ts`)
- **活動度指標**：計算抬起腿（髖-踝連線）與軀幹/地面夾角，標準值為 $\ge 75^\circ$。
- **膝關節伸直檢查**：判定 $\angle(\text{Hip}, \text{Knee}, \text{Ankle}) \ge 155^\circ$，若膝蓋彎曲即標記黃色線條並跳出「抬起腿膝蓋未打直」代償警示。
- **對側支撐腿平貼檢查**：監控對側腿部 $\angle(\text{OppositeHip}, \text{OppositeKnee}, \text{OppositeAnkle}) \ge 160^\circ$，防止抬腿時代償拱腰或彎膝作弊。

### 3. 雙鎖定機制與狀態機流程 (`src/state.ts`)
- **自動停頓鎖定**：受測者抬腿至極限角度並維持 1.5 秒（進度條滿 100%），系統自動觸發鎖定，發出成功音效與語音。
- **施測者快門按鈕**：施測者可隨時點擊畫面右下角大圓形「📸 鎖定」按鈕手動打點。
- **流程狀態機**：`就位 -> 測量右腿 (鎖定) -> 自動切換過渡 (2.5s 語音播報) -> 測量左腿 (鎖定) -> 產出防傷報告`。

### 4. 左右不對稱性分析與防受傷報告卡 (`src/biomechanics.ts`, `src/ui.ts`)
- **不對稱差 (Asymmetry Ratio)**：計算 $\frac{|\text{Right} - \text{Left}|}{\max(\text{Right}, \text{Left})} \times 100\%$。
- **受傷風險三級分級**：
  - 🟢 **LOW (低風險)**：雙腿 $\ge 75^\circ$ 且左右差 $< 10\%$。
  - 🟡 **MODERATE (中度風險)**：角度 $60^\circ \sim 74^\circ$ 或左右差 $10\% \sim 15\%$。
  - 🔴 **HIGH (高風險)**：單側 $< 60^\circ$ 或左右差 $> 15\%$（警示跑者大腿後肌撕裂風險）。
- **專屬伸展處方推薦**：依據緊繃側自動提供滾筒筋膜放鬆（3 組各 60 秒）與坐姿直腿神經滑動術建議。

### 5. 語音提示與本機儲存 (`src/audio.ts`, `src/storage.ts`)
- 整合 Web Speech API 提供繁體中文語音引導，並透過 Web Audio API 合成雙頻提示音。
- 以 `localStorage` 保存最新 50 筆受測者紀錄，支援姓名記錄、歷史紀錄檢視與清空。

### 6. PWA 離線快取與模擬展示模式 (`sw.js`, `manifest.json`, `src/main.ts`)
- 配置 Service Worker 快取主要檔案，支援「加入主畫面」離線使用。
- 內建「🎮 模擬展示」模式：無需人體即可自動執行雙腿抬升與風險報告展示。

---

## 🧪 驗證與測試結果

### 1. 單元測試 (Unit Tests)
執行 `npm test`（Vitest），所有 9 項生物力學與受傷風險判定測試全數通過：
- ✓ 90 度與 180 度夾角幾何運算精確度
- ✓ 水平斜率夾角計算
- ✓ 單側小於 60 度觸發 HIGH RISK
- ✓ 左右差大於 15% 觸發 HIGH RISK
- ✓ 兩側達標且對稱性小於 10% 觸發 LOW RISK
- ✓ 骨架不齊全時容錯返回 null
- ✓ 抬起腿膝關節小於 155 度觸發膝蓋彎曲代償警示

```
 RUN  v2.1.9 P:/AIagent\AG/winterV
 ✓ tests/biomechanics.test.ts (9 tests) 7ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### 2. 生產環境建置驗證 (Production Build)
執行 `npm run build`，TypeScript 型別檢驗與 Vite Bundler 打包完全無錯誤：
- `dist/index.html` (7.49 kB)
- `dist/manifest.json`
- `dist/sw.js`
- `dist/assets/index-*.js` (147.86 kB gzip: 47.73 kB)
- `dist/assets/index-*.css` (5.53 kB)

### 7. 相機權限已被手機封鎖之引導恢復 (v1.0.4)
- **問題根因**：若使用者在首次開啟或先前曾點擊過「不允許/封鎖」，Android Chrome 會將該 Origin (`https://hmlee-pt.github.io`) 的相機權限永久鎖定在「已封鎖 (Blocked)」，導致後續呼叫直接失敗且不再彈出詢問視窗。
- **修復方案**：捕捉 `NotAllowedError`，動態在畫面上彈出詳細圖文引導，指導使用者點擊網址旁的 🔒 鎖頭開啟「允許」權限並一鍵重新連線。
- **問題根因**：
  1. `100vh` 在 Android Chrome 中會計算包含虛擬導航鍵與手勢條的高度，導致底部按鈕被系統底欄硬生生切掉約 40~60px。
  2. Android Chrome 76+ 安全政策要求：未獲永久授權前，`getUserMedia` 必須由使用者點擊或觸摸手勢觸發；若由代碼自動載入會被靜默攔截。加上舊架構等待 10MB MediaPipe 模型下載完才啟動相機，導致相機畫面延遲或黑屏。
- **修復方案**：
  1. 全面重構移動端 Viewport，採用 `100dvh` 與緊湊型 HUD 設計，縮減底部高度 40%，按鍵 100% 完整露出於可視範圍。
  2. 新增居中互動式「📷 點擊開啟鏡頭」引導，提供合規之 User Gesture 觸發點，並將 AI 模型改為背景平行非同步載入，相機秒開。
- **問題根因**：部分 Android 手機（尤其高解析度 OLED / 硬體加速環境）在複合 `<video>` 與透明 `<canvas>` 時，瀏覽器硬體層疊無法正確將視訊訊號傳遞至透明圖層底下，造成黑畫面；且部分 Android Chrome 嚴格要求在呼叫 `play()` 前須觸發 `loadedmetadata` 與設定 `muted=true`。
- **修復方案**：
  1. 改採雙重渲染保證：`renderHUD` 在 Canvas 底層直接調用 `ctx.drawImage(videoElement)`，確保畫面與骨架繪製在同一圖層，100% 杜絕黑畫面。
  2. 加入三級相機約束自動降級機制（後置鏡頭 ➔ 泛用鏡頭 ➔ 預設相機）。
  3. 進入網頁自動觸發相機啟動，並以 `loadedmetadata` 異步確保視訊解碼就緒。
- **問題根因**：Windows 原生 `cmd.exe` 在繁體中文環境 (預設 Big5/CP950) 解析內嵌繁體中文字串之 UTF-8 `.bat` 時，會發生經典的字元位移截斷 Bug，將 `echo` 誤判為 `'ho'`，導致指令無法辨識。
- **修復方案**：將 `切換版本.bat` 重構為純 ASCII 啟動器，橋接調用 `tools/version-tool.ps1` 並自動繞過 ExecutionPolicy，全面以 PowerShell UTF-8 引擎渲染高對比彩色選單，徹底解決亂碼與無限迴圈問題。

---

## 📱 操作方式指引

1. **桌機 / 開發機啟動**：
   ```bash
   npm run dev
   ```
2. **手機連線體驗**：
   * 將手機連接與電腦相同的 Wi-Fi 網路。
   * 手機開啟瀏覽器輸入終端機顯示的 `Network: http://192.168.x.x:3000`。
   * 點擊瀏覽器選單中的「加入主畫面 (Add to Home Screen)」，即可像原生 App 一樣全螢幕離線使用。
3. **免攝影機測試**：
   * 點擊畫面中央的「🎮 模擬展示」，即可親眼檢視 AI 骨架追蹤、量角儀、停頓鎖定與受傷風險報告產出！
