/**
 * 運動員防受傷檢測系統 - 主程式進入點 (Application Main Entry)
 */

import './style.css';
import { poseDetector } from './detector';
import { stateManager, StateSnapshot } from './state';
import { renderHUD, RenderContext } from './ui';
import { inclinometerSensor } from './sensors';
import { soundManager } from './audio';
import { saveAssessmentRecord, getAssessmentRecords, clearAssessmentRecords } from './storage';
import { NormalizedLandmark } from './biomechanics';

// DOM 元素參考
const videoEl = document.getElementById('webcam') as HTMLVideoElement;
const canvasEl = document.getElementById('output-canvas') as HTMLCanvasElement;
const ctx = canvasEl.getContext('2d')!;

// 狀態與儀表板元素
const statusPill = document.getElementById('status-pill')!;
const levelDot = document.getElementById('level-dot')!;
const levelText = document.getElementById('level-text')!;
const valRight = document.getElementById('val-right')!;
const valLeft = document.getElementById('val-left')!;
const valAsymmetry = document.getElementById('val-asymmetry')!;
const cardRight = document.getElementById('card-right')!;
const cardLeft = document.getElementById('card-left')!;

// 按鈕
const btnMainAction = document.getElementById('btn-main-action') as HTMLButtonElement;
const btnShutter = document.getElementById('btn-shutter') as HTMLButtonElement;
const btnDemo = document.getElementById('btn-demo') as HTMLButtonElement;
const btnSoundToggle = document.getElementById('btn-sound-toggle') as HTMLButtonElement;
const soundIcon = document.getElementById('sound-icon')!;
const btnCameraFlip = document.getElementById('btn-camera-flip') as HTMLButtonElement;
const btnHistory = document.getElementById('btn-history') as HTMLButtonElement;
const btnHelp = document.getElementById('btn-help') as HTMLButtonElement;

// 彈窗
const modalReport = document.getElementById('modal-report')!;
const modalHistory = document.getElementById('modal-history')!;
const modalHelp = document.getElementById('modal-help')!;
const btnCloseReport = document.getElementById('btn-close-report')!;
const btnRestartTest = document.getElementById('btn-restart-test')!;
const btnCloseHistory = document.getElementById('btn-close-history')!;
const btnClearHistory = document.getElementById('btn-clear-history')!;
const btnCloseHelp = document.getElementById('btn-close-help')!;
const btnSaveRecord = document.getElementById('btn-save-record')!;
const inputAthleteName = document.getElementById('input-athlete-name') as HTMLInputElement;

// 執行階段變數
let stream: MediaStream | null = null;
let currentFacingMode: 'environment' | 'user' = 'environment';
let isRunning = false;
let isDemoMode = false;
let lastLandmarks: NormalizedLandmark[] | null = null;

/**
 * 初始化相機串流
 */
async function startCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  try {
    statusPill.textContent = '正在啟動相機...';
    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: currentFacingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await videoEl.play();

    // 啟動手機電子水平儀感測
    await inclinometerSensor.requestPermission();

    statusPill.textContent = '相機已就緒，請對準受測者側面';
    resizeCanvas();
    return true;
  } catch (err) {
    console.warn('後置相機存取失敗，嘗試切換預設鏡頭:', err);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      videoEl.srcObject = stream;
      await videoEl.play();
      resizeCanvas();
      return true;
    } catch (e2) {
      console.error('無法啟動相機:', e2);
      statusPill.textContent = '⚠️ 無法取得相機權限（可點擊「模擬展示」體驗）';
      return false;
    }
  }
}

function resizeCanvas() {
  const rect = videoEl.getBoundingClientRect();
  canvasEl.width = rect.width || window.innerWidth;
  canvasEl.height = rect.height || window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);

/**
 * 監聽狀態機變更
 */
stateManager.subscribe((snapshot: StateSnapshot) => {
  statusPill.textContent = snapshot.statusMessage;

  // 更新讀數儀表板
  if (snapshot.rightPeakAngle !== null) {
    valRight.textContent = `${snapshot.rightPeakAngle}°`;
  } else if (snapshot.step === 'MEASURING_RIGHT') {
    valRight.textContent = `${Math.round(snapshot.currentAngle)}°`;
  } else {
    valRight.textContent = '--°';
  }

  if (snapshot.leftPeakAngle !== null) {
    valLeft.textContent = `${snapshot.leftPeakAngle}°`;
  } else if (snapshot.step === 'MEASURING_LEFT') {
    valLeft.textContent = `${Math.round(snapshot.currentAngle)}°`;
  } else {
    valLeft.textContent = '--°';
  }

  // 左右不對稱差
  if (snapshot.rightPeakAngle !== null && snapshot.leftPeakAngle !== null) {
    const maxA = Math.max(snapshot.rightPeakAngle, snapshot.leftPeakAngle, 1);
    const diff = Math.abs(snapshot.rightPeakAngle - snapshot.leftPeakAngle);
    const ratio = Math.round((diff / maxA) * 1000) / 10;
    valAsymmetry.textContent = `${ratio}%`;
    valAsymmetry.style.color = ratio > 15 ? '#ef4444' : ratio >= 10 ? '#f59e0b' : '#10b981';
  } else {
    valAsymmetry.textContent = '--%';
    valAsymmetry.style.color = 'var(--brand-cyan)';
  }

  // 高亮當前測量側
  if (snapshot.step === 'MEASURING_RIGHT') {
    cardRight.classList.add('active');
    cardLeft.classList.remove('active');
    btnShutter.style.display = 'flex';
    btnMainAction.textContent = '⏹️ 終止檢測';
  } else if (snapshot.step === 'MEASURING_LEFT') {
    cardRight.classList.remove('active');
    cardLeft.classList.add('active');
    btnShutter.style.display = 'flex';
    btnMainAction.textContent = '⏹️ 終止檢測';
  } else if (snapshot.step === 'REPORT') {
    cardRight.classList.remove('active');
    cardLeft.classList.remove('active');
    btnShutter.style.display = 'none';
    btnMainAction.textContent = '🔄 重新檢測';
    if (snapshot.report) {
      showReportModal(snapshot.report);
    }
  } else {
    cardRight.classList.remove('active');
    cardLeft.classList.remove('active');
    btnShutter.style.display = 'none';
    btnMainAction.textContent = '▶️ 開始檢測';
  }
});

/**
 * 顯示評估報告彈窗
 */
function showReportModal(rep: ReturnType<typeof stateManager.getSnapshot>['report']) {
  if (!rep) return;

  const now = new Date();
  document.getElementById('report-time')!.textContent = now.toLocaleString('zh-TW');

  const badge = document.getElementById('report-risk-badge')!;
  badge.className = `risk-badge ${rep.riskLevel}`;
  badge.textContent =
    rep.riskLevel === 'LOW' ? '✅ 低受傷風險' : rep.riskLevel === 'MODERATE' ? '⚠️ 中度受傷風險' : '🚨 高度受傷風險';

  document.getElementById('rep-right-angle')!.textContent = `${rep.rightAngle}°`;
  document.getElementById('rep-left-angle')!.textContent = `${rep.leftAngle}°`;
  document.getElementById('rep-asymmetry-val')!.textContent = `${rep.asymmetryRatio}% (相差 ${rep.asymmetryDifference}°)`;
  document.getElementById('rep-description')!.textContent = rep.description;

  const recList = document.getElementById('rep-recommendations')!;
  recList.innerHTML = '';
  rep.recommendations.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'rec-item';
    div.textContent = item;
    recList.appendChild(div);
  });

  modalReport.classList.add('active');
}

/**
 * 即時偵測運算循環 (Detection & Rendering Loop)
 */
function tick() {
  if (!isRunning) return;

  // 1. 更新電子水平儀狀態
  const level = inclinometerSensor.getStatus();
  levelDot.style.backgroundColor = level.color;
  levelText.textContent = level.statusText;

  // 2. 執行 AI 姿態辨識
  if (!isDemoMode && videoEl.readyState >= 2) {
    const result = poseDetector.detect(videoEl, performance.now());
    if (result && result.landmarks && result.landmarks[0]) {
      lastLandmarks = result.landmarks[0];
      stateManager.updatePose(lastLandmarks);
    } else {
      lastLandmarks = null;
    }
  }

  // 3. 繪製 HUD Overlay
  const snap = stateManager.getSnapshot();
  const activeSide =
    snap.step === 'MEASURING_RIGHT' ? 'right' : snap.step === 'MEASURING_LEFT' ? 'left' : null;

  const renderContext: RenderContext = {
    canvas: canvasEl,
    ctx,
    landmarks: lastLandmarks,
    currentAngle: snap.currentAngle,
    peakAngle: snap.peakAngle,
    activeSide,
    isKneeStraight: snap.isKneeStraight,
    isSupportLegFlat: snap.isSupportLegFlat,
    compensationWarning: snap.compensationWarning,
    holdProgress: snap.holdProgress,
    levelStatus: level,
  };

  renderHUD(renderContext);

  requestAnimationFrame(tick);
}

/**
 * 模擬展示模式 (Demo Simulation Mode)
 * 在沒有攝影機或桌機瀏覽環境下，模擬仰臥抬腿動作展示全流程
 */
function runDemoSimulation() {
  isDemoMode = true;
  statusPill.textContent = '🎮 正在運行示範模擬模式...';

  stateManager.startAssessment();

  let progress = 0;
  const generateSimulatedLandmarks = (legAngle: number, side: 'right' | 'left'): NormalizedLandmark[] => {
    // 模擬受測者仰臥平躺 (頭部在左，雙腿在右)
    const rad = (legAngle * Math.PI) / 180;
    const hipX = 0.55;
    const hipY = 0.65;
    const legLength = 0.3;

    const ankleX = hipX + legLength * Math.cos(rad);
    const ankleY = hipY - legLength * Math.sin(rad); // 抬腿 y 減小 (向上)
    const kneeX = hipX + (legLength / 2) * Math.cos(rad);
    const kneeY = hipY - (legLength / 2) * Math.sin(rad);

    const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.65,
      visibility: 0.9,
    }));

    // 軀幹
    landmarks[11] = { x: 0.25, y: 0.63, visibility: 0.95 }; // left shoulder
    landmarks[12] = { x: 0.25, y: 0.65, visibility: 0.95 }; // right shoulder
    landmarks[23] = { x: hipX, y: 0.63, visibility: 0.95 }; // left hip
    landmarks[24] = { x: hipX, y: 0.65, visibility: 0.95 }; // right hip

    if (side === 'right') {
      // 右腿抬起
      landmarks[26] = { x: kneeX, y: kneeY, visibility: 0.95 };
      landmarks[28] = { x: ankleX, y: ankleY, visibility: 0.95 };
      // 左腿貼地
      landmarks[25] = { x: hipX + legLength / 2, y: 0.65, visibility: 0.95 };
      landmarks[27] = { x: hipX + legLength, y: 0.65, visibility: 0.95 };
    } else {
      // 左腿抬起
      landmarks[25] = { x: kneeX, y: kneeY, visibility: 0.95 };
      landmarks[27] = { x: ankleX, y: ankleY, visibility: 0.95 };
      // 右腿貼地
      landmarks[26] = { x: hipX + legLength / 2, y: 0.65, visibility: 0.95 };
      landmarks[28] = { x: hipX + legLength, y: 0.65, visibility: 0.95 };
    }

    return landmarks;
  };

  const simInterval = setInterval(() => {
    const snap = stateManager.getSnapshot();

    if (snap.step === 'MEASURING_RIGHT') {
      progress += 0.8;
      const angle = Math.min(82, 10 + progress * 1.5);
      lastLandmarks = generateSimulatedLandmarks(angle, 'right');
      stateManager.updatePose(lastLandmarks);
    } else if (snap.step === 'MEASURING_LEFT') {
      progress += 0.8;
      // 模擬左腿較緊繃 (僅能抬至 65°，產生不對稱差)
      const angle = Math.min(65, 10 + progress * 1.5);
      lastLandmarks = generateSimulatedLandmarks(angle, 'left');
      stateManager.updatePose(lastLandmarks);
    } else if (snap.step === 'REPORT' || snap.step === 'IDLE') {
      clearInterval(simInterval);
      isDemoMode = false;
    }
  }, 40);
}

// ----------------- 事件綁定 -----------------

// 主要動作按鈕 (開始 / 終止 / 重新檢測)
btnMainAction.addEventListener('click', async () => {
  const snap = stateManager.getSnapshot();
  if (snap.step === 'IDLE' || snap.step === 'REPORT') {
    if (!stream) {
      await startCamera();
    }
    stateManager.startAssessment();
  } else {
    stateManager.reset();
  }
});

// 手動鎖定快門按鈕
btnShutter.addEventListener('click', () => {
  stateManager.triggerManualLock();
});

// 模擬展示按鈕
btnDemo.addEventListener('click', () => {
  runDemoSimulation();
});

// 語音切換
btnSoundToggle.addEventListener('click', () => {
  const muted = !soundManager.getIsMuted();
  soundManager.setMuted(muted);
  soundIcon.textContent = muted ? '🔇' : '🔊';
});

// 前後鏡頭切換
btnCameraFlip.addEventListener('click', async () => {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
});

// 施測者指南彈窗
btnHelp.addEventListener('click', () => {
  modalHelp.classList.add('active');
});
btnCloseHelp.addEventListener('click', () => {
  modalHelp.classList.remove('active');
});

// 報告彈窗關閉與重測
btnCloseReport.addEventListener('click', () => {
  modalReport.classList.remove('active');
});
btnRestartTest.addEventListener('click', () => {
  modalReport.classList.remove('active');
  stateManager.startAssessment();
});

// 儲存評估紀錄
btnSaveRecord.addEventListener('click', () => {
  const snap = stateManager.getSnapshot();
  if (!snap.report) return;

  const name = inputAthleteName.value || '未命名運動員';
  saveAssessmentRecord(name, snap.report);
  btnSaveRecord.textContent = '✅ 已儲存！';
  setTimeout(() => {
    btnSaveRecord.textContent = '💾 儲存紀錄';
  }, 2000);
});

// 歷史紀錄彈窗
btnHistory.addEventListener('click', () => {
  renderHistoryList();
  modalHistory.classList.add('active');
});
btnCloseHistory.addEventListener('click', () => {
  modalHistory.classList.remove('active');
});
btnClearHistory.addEventListener('click', () => {
  if (confirm('確定要清空所有歷史紀錄嗎？')) {
    clearAssessmentRecords();
    renderHistoryList();
  }
});

function renderHistoryList() {
  const listEl = document.getElementById('history-list')!;
  const records = getAssessmentRecords();
  listEl.innerHTML = '';

  if (records.length === 0) {
    listEl.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 20px;">尚無檢測紀錄</div>';
    return;
  }

  records.forEach((rec) => {
    const item = document.createElement('div');
    item.style.cssText =
      'background: rgba(255,255,255,0.04); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px; display: flex; justify-content: space-between; align-items: center;';

    const riskColor =
      rec.report.riskLevel === 'LOW' ? '#10b981' : rec.report.riskLevel === 'MODERATE' ? '#f59e0b' : '#ef4444';

    const safeAthleteName = rec.athleteName.replace(/[&<>'"]/g, (tag) => {
      const chars: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
      return chars[tag] || tag;
    });

    item.innerHTML = `
      <div>
        <div style="font-weight: 600; font-size: 14px;">${safeAthleteName}</div>
        <div style="font-size: 11px; color: var(--text-secondary);">${rec.dateStr}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 13px; font-weight: 700;">右 ${rec.report.rightAngle}° / 左 ${rec.report.leftAngle}°</div>
        <div style="font-size: 11px; color: ${riskColor}; font-weight: 600;">差 ${rec.report.asymmetryRatio}% (${rec.report.riskLevel})</div>
      </div>
    `;
    listEl.appendChild(item);
  });
}

// 點擊彈窗遮罩關閉
[modalReport, modalHistory, modalHelp].forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
});

// 註冊 Service Worker (PWA 離線支援)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service Worker 註冊略過:', err);
    });
  });
}

// 啟動主流程
async function bootstrap() {
  statusPill.textContent = '正在啟動 AI 骨架引擎...';
  isRunning = true;
  requestAnimationFrame(tick);

  // 初始化 MediaPipe
  await poseDetector.initialize((msg) => {
    statusPill.textContent = msg;
  });

  statusPill.textContent = '系統就緒！點擊「開始檢測」啟動相機';
}

bootstrap();
