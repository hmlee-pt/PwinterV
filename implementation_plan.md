# 實施計劃 (Implementation Plan) - 運動員關節活動度與防受傷檢測 PWA (v1.0.0)

## 專案簡介
本專案為一套基於手機鏡頭與端側 AI 電腦視覺 (Pose Estimation) 的**專項運動員防受傷篩檢與關節活動度 (ROM) 量測 PWA (Progressive Web App)**。
由施測者（教練、訓練員或家長）手持手機拍攝，即時捕捉受測者肢體骨架、計算關節動態活動度夾角、偵測代償動作，並針對左右側不對稱性 (Left-Right Asymmetry) 評估運動受傷風險，提供即時防傷與動態伸展處方。

---

## 核心功能與技術規格

### 1. 施測者手持專用 UI / HUD
- **即時骨架追蹤與角度儀**：在相機預覽畫面上即時繪製 33 點人體骨骼連線與關節量角弧度（度數標記）。
- **電子水平儀 (Digital Bubble Level)**：調用手機陀螺儀/加速度計 (`DeviceOrientationEvent`)，確保施測者手持角度平視垂直地面，降低拍攝仰角與透視誤差。
- **雙鎖定機制**：
  - 自動停頓鎖定：受測者抬腿至最高點並維持 1.5 秒自動取樣鎖定。
  - 手動拍照鎖定：施測者可隨時點擊螢幕快門按鈕直接記錄峰值角度。

### 2. 核心量測動作 (MVP)
- **主動直膝抬腿 (Active Straight-Leg Raise, ASLR)**：
  - 量測指標：抬起腿之髖關節-腳踝連線與水平地面的夾角 $\theta$。
  - 防代償機制：監測對側支撐腿之膝關節是否離地彎曲。
  - 左右對比：記錄左腿與右腿之峰值角度，計算不對稱差 (Asymmetry Ratio)。

### 3. 受傷風險評估與伸展處方
- **風險分級**：
  - 綠燈 (優秀/低風險)：兩腿均 $\ge 75^\circ$，左右差 $< 10\%$。
  - 黃燈 (中度風險)：角度 $60^\circ \sim 74^\circ$ 或 左右差 $10\% \sim 15\%$。
  - 紅燈 (高受傷風險)：單側 $< 60^\circ$ 或 左右差 $> 15\%$（常見於跑者大腿後肌拉傷高危險群）。
- **個人化建議**：依據緊繃側即時推送針對性伸展動作（如滾筒放鬆膕繩肌、神經滑動術）。

### 4. 離線 PWA 與隱私保護
- **零影像上傳 (Edge AI)**：影像完全在瀏覽器本機記憶體處理，使用 Google MediaPipe Pose 進行 WebAssembly 推論，保障隱私。
- **PWA 支援**：配置 Web App Manifest 與 Service Worker 快取，支援「加入主畫面」全螢幕運行與離線無網路使用。

---

## 技術棧選型
- **開發構建**：Vite + TypeScript
- **樣式與 UI**：Tailwind CSS / 現代高對比運動科技風深色主題 (Dark Cyber-Athletic UI)
- **AI 視覺**：Google MediaPipe Pose (`@mediapipe/tasks-vision` / `@mediapipe/pose`)
- **語音引導**：Web Speech API (`window.speechSynthesis`)
- **方向感測**：Web DeviceOrientation API

---

## 階段實施規劃

- [ ] **階段 1：專案初始化與版控設定**
  - 初始化 Git 與 `.gitignore`
  - 建立 Vite + TypeScript 專案架構
  - 建立版本切換工具 `切換版本.bat` 與專案文件
- [ ] **階段 2：相機串流、水平儀與 MediaPipe 整合**
  - 手機鏡頭串流存取與自適應解析度
  - 電子水平儀即時指示器（提示施測者手持平正）
  - MediaPipe Pose 模型載入與 Canvas 即時骨架繪製
- [ ] **階段 3：動作檢測狀態機與 ASLR 演算法**
  - 實作 ASLR 向量角度計算與支撐腿代償判定
  - 實作「就位 -> 右腳量測 -> 左腳量測 -> 完成」狀態流轉
  - 實作自動峰值鎖定與手動鎖定按鈕
  - 語音提示與音效回饋
- [ ] **階段 4：左右不對稱性分析與防傷報告卡**
  - 計算左右差比率與受傷風險評等
  - 視覺化報告卡彈窗、伸展處方與匯出/分享
  - 歷史紀錄本機儲存 (LocalStorage)
- [ ] **階段 5：PWA 離線快取與跨裝置適配**
  - 加入 PWA Manifest 與 Service Worker 離線快取
  - 驗證手機橫向/直向相容性與資安防護規範
  - 建立測試套件驗證角度演算法精準度
- [ ] **階段 6：版本發布、Git Tag 與驗證交付**
  - 建立 `v1.0.0` Git Commit 與實體 Tag 快照
  - 產出完整 `walkthrough.md` 驗證報告
