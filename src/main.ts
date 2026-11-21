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

// 畫面快照擷取回呼 (供狀態機在鎖定最高點時取得即時照片)
stateManager.onCaptureRequest = () => {
  try {
    return canvasEl.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.warn('畫面截圖失敗:', err);
    return '';
  }
};

// 狀態與儀表板元素
const statusPill = document.getElementById('status-pill')!;
const levelDot = document.getElementById('level-dot')!;
const levelText = document.getElementById('level-text');
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

// 相機引導遮罩元件
const cameraPromptOverlay = document.getElementById('camera-prompt-overlay') as HTMLElement;
const btnStartCameraNow = document.getElementById('btn-start-camera-now') as HTMLButtonElement;

// 橫向持機與 PWA 更新提示
const autoRotateNotice = document.getElementById('auto-rotate-notice') as HTMLElement;
const pwaUpdateToast = document.getElementById('pwa-update-toast') as HTMLElement;
const btnPwaRefresh = document.getElementById('btn-pwa-refresh') as HTMLButtonElement;

// LINE 瀏覽器阻擋相機提示
const lineNoticeOverlay = document.getElementById('line-notice-overlay');
const btnOpenChrome = document.getElementById('btn-open-chrome');

// 語音教練引導與自動檢測狀態變數
let hasSpokenReadyPrompt = false;
let lastTiltWarningTime = 0;
let autoStartEligibleStartTime = 0;
let hasAutoStarted = false;

// 執行階段變數
let stream: MediaStream | null = null;
let currentFacingMode: 'environment' | 'user' = 'environment';
let isRunning = false;
let isDemoMode = false;
let lastLandmarks: NormalizedLandmark[] | null = null;

/**
 * 初始化相機串流 (強化相容 Android / iOS 多鏡頭與底層 WebRTC 視訊播放)
 */
async function startCamera(): Promise<boolean> {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.setAttribute('autoplay', '');
  videoEl.setAttribute('muted', '');
  videoEl.setAttribute('playsinline', 'true');
  videoEl.setAttribute('webkit-playsinline', 'true');

  statusPill.textContent = '正在啟動相機...請在手機彈窗點選「允許」';

  let lastCameraErrorName = '';
  const tryGetStream = async (constraints: MediaStreamConstraints): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'name' in e) {
        lastCameraErrorName = String((e as { name: string }).name);
      }
      console.warn('嘗試相機模式失敗:', constraints, e);
      return null;
    }
  };

  // 1. 優先嘗試後置相機 (手持施測者視角)
  let newStream: MediaStream | null = await tryGetStream({
    video: {
      facingMode: { ideal: currentFacingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  // 2. 降級嘗試僅指定 facingMode
  if (!newStream) {
    newStream = await tryGetStream({
      video: { facingMode: currentFacingMode },
      audio: false,
    });
  }

  // 3. 降級嘗試通用預設相機 (所有 Android / PC 保證支援)
  if (!newStream) {
    newStream = await tryGetStream({
      video: true,
      audio: false,
    });
  }

  if (!newStream) {
    const errName = lastCameraErrorName;
    let guideHtml = `
      <div class="prompt-icon">🔒</div>
      <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 6px; color: #f87171;">相機權限已被手機瀏覽器封鎖</h3>
      <div style="font-size: 12px; color: #cbd5e1; line-height: 1.6; text-align: left; background: rgba(0,0,0,0.4); padding: 10px 14px; border-radius: 10px; margin: 8px 0;">
        <p><strong>如何手動解鎖（只需 10 秒）：</strong></p>
        <p>1. 點擊網址列左側的 <strong>🔒 鎖頭圖示</strong>（或調整圖示）。</p>
        <p>2. 點選 <strong>「權限」</strong> 或 <strong>「網站設定」</strong>。</p>
        <p>3. 找到 <strong>「相機」</strong>，將其改為 <strong>「允許」</strong>。</p>
        <p>4. 點擊下方按鈕重新啟動！</p>
      </div>
      <button id="btn-retry-camera" class="btn-primary" style="margin-top: 8px; width: 100%;">
        🔄 我已解鎖，重新啟動相機
      </button>
    `;

    if (errName === 'NotReadableError') {
      guideHtml = `
        <div class="prompt-icon">📷</div>
        <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 6px; color: #fbbf24;">相機正被其他應用程式佔用</h3>
        <p style="font-size: 12px; color: #cbd5e1; margin-bottom: 12px;">請先滑掉關閉手機相機 App、LINE 或視訊軟體，然後重試。</p>
        <button id="btn-retry-camera" class="btn-primary" style="width: 100%;">🔄 重新連線相機</button>
      `;
    }

    if (cameraPromptOverlay) {
      cameraPromptOverlay.innerHTML = guideHtml;
      cameraPromptOverlay.classList.remove('hidden');
      document.getElementById('btn-retry-camera')?.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.reload();
      });
    }

    statusPill.textContent = '⚠️ 請依畫面指引解除相機封鎖';
    return false;
  }

  stream = newStream;
  videoEl.srcObject = stream;
  cameraPromptOverlay?.classList.add('hidden');

  // 關鍵：等待視訊中繼資料載入完成，確保 Android 瀏覽器正常開始播放畫面
  await new Promise<void>((resolve) => {
    const onPlayReady = () => {
      videoEl.play().catch((err) => console.warn('視訊 play() 略過:', err));
      resolve();
    };

    if (videoEl.readyState >= 1) {
      onPlayReady();
    } else {
      videoEl.onloadedmetadata = onPlayReady;
      setTimeout(onPlayReady, 1200);
    }
  });

  // 啟動手機電子水平儀感測
  try {
    await inclinometerSensor.requestPermission();
  } catch (err) {
    console.warn('水平儀授權略過:', err);
  }

  statusPill.textContent = '✅ 相機已就緒！請將鏡頭對準受測者側面';
  resizeCanvas();
  return true;
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

  // 高亮當前測量側與操作按鈕狀態更新
  if (snapshot.step === 'MEASURING_RIGHT' || snapshot.step === 'MEASURING_LEFT' || snapshot.step === 'TRANSITION') {
    if (snapshot.step === 'MEASURING_RIGHT') {
      cardRight.classList.add('active');
      cardLeft.classList.remove('active');
    } else if (snapshot.step === 'MEASURING_LEFT') {
      cardRight.classList.remove('active');
      cardLeft.classList.add('active');
    } else {
      cardRight.classList.remove('active');
      cardLeft.classList.remove('active');
    }
    btnShutter.style.display = snapshot.step === 'TRANSITION' ? 'none' : 'flex';
    btnMainAction.textContent = '🔄 重新檢測 / 終止';
    btnMainAction.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
  } else if (snapshot.step === 'REPORT') {
    cardRight.classList.remove('active');
    cardLeft.classList.remove('active');
    btnShutter.style.display = 'none';
    btnMainAction.textContent = '🔄 重新檢測';
    btnMainAction.style.background = '';
    if (snapshot.report) {
      showReportModal(snapshot.report);
    }
  } else {
    cardRight.classList.remove('active');
    cardLeft.classList.remove('active');
    btnShutter.style.display = 'none';
    btnMainAction.textContent = '▶️ 開始檢測';
    btnMainAction.style.background = '';
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

  // FMS 官方評分資訊
  const fmsScoreEl = document.getElementById('rep-fms-score');
  const fmsDescEl = document.getElementById('rep-fms-desc');
  if (fmsScoreEl) fmsScoreEl.textContent = `${rep.fmsTotalScore} / 3 分`;
  if (fmsDescEl) fmsDescEl.textContent = rep.fmsScoreDescription;

  document.getElementById('rep-right-angle')!.textContent = `${rep.rightAngle}°`;
  document.getElementById('rep-left-angle')!.textContent = `${rep.leftAngle}°`;
  document.getElementById('rep-asymmetry-val')!.textContent = `${rep.asymmetryRatio}% (相差 ${rep.asymmetryDifference}°)`;
  document.getElementById('rep-description')!.textContent = rep.description;

  // 最高點實體照片截圖憑證展示
  const repSnapshotsSec = document.getElementById('rep-snapshots-section');
  const imgRight = document.getElementById('img-snapshot-right') as HTMLImageElement;
  const imgLeft = document.getElementById('img-snapshot-left') as HTMLImageElement;
  if (repSnapshotsSec && imgRight && imgLeft) {
    if (rep.rightSnapshotUrl || rep.leftSnapshotUrl) {
      repSnapshotsSec.style.display = 'block';
      if (rep.rightSnapshotUrl) imgRight.src = rep.rightSnapshotUrl;
      if (rep.leftSnapshotUrl) imgLeft.src = rep.leftSnapshotUrl;
    } else {
      repSnapshotsSec.style.display = 'none';
    }
  }

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
  levelDot.parentElement?.setAttribute('title', level.statusText);
  if (levelText) {
    levelText.textContent = level.statusText;
  }

  // 1.1 檢測是否物理橫放但螢幕處於直向鎖定
  const isScreenPortrait = window.innerWidth < window.innerHeight;
  if (autoRotateNotice) {
    if (level.isHoldingLandscape && isScreenPortrait) {
      autoRotateNotice.style.display = 'block';
    } else {
      autoRotateNotice.style.display = 'none';
    }
  }

  // 1.2 語音教練與免動手自動檢測：判斷相機視角與距離是否進入可拍攝模式
  const snap = stateManager.getSnapshot();
  if (snap.step === 'IDLE' && !isDemoMode && videoEl.readyState >= 2) {
    const isBodyInFrame =
      lastLandmarks &&
      lastLandmarks.length >= 29 &&
      ((lastLandmarks[11]?.visibility ?? 0) > 0.45 || (lastLandmarks[12]?.visibility ?? 0) > 0.45) &&
      ((lastLandmarks[27]?.visibility ?? 0) > 0.35 || (lastLandmarks[28]?.visibility ?? 0) > 0.35);

    if (level.isLevel && isBodyInFrame) {
      if (!hasSpokenReadyPrompt) {
        hasSpokenReadyPrompt = true;
        soundManager.speak('視角平正，全身已入鏡。', false);
      }

      if (autoStartEligibleStartTime === 0) {
        autoStartEligibleStartTime = performance.now();
      }

      const elapsed = performance.now() - autoStartEligibleStartTime;
      if (elapsed > 1200 && !hasAutoStarted) {
        hasAutoStarted = true;
        soundManager.speak('檢測條件符合，三、二、一，開始檢測！', true);
        soundManager.playCountdownTone();
        setTimeout(() => {
          if (stateManager.getSnapshot().step === 'IDLE') {
            stateManager.startAssessment();
          }
        }, 1200);
      }
    } else {
      autoStartEligibleStartTime = 0;
      if (!level.isLevel && level.deviation > 25) {
        const now = Date.now();
        if (now - lastTiltWarningTime > 12000) {
          lastTiltWarningTime = now;
          soundManager.speak('請將手機拿正平視。', false);
        }
      }
    }
  } else if (snap.step !== 'IDLE') {
    hasAutoStarted = false;
    autoStartEligibleStartTime = 0;
  }

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
  const currentSnap = stateManager.getSnapshot();
  const activeSide =
    currentSnap.step === 'MEASURING_RIGHT' ? 'right' : currentSnap.step === 'MEASURING_LEFT' ? 'left' : null;

  const renderContext: RenderContext = {
    canvas: canvasEl,
    ctx,
    landmarks: lastLandmarks,
    currentAngle: currentSnap.currentAngle,
    peakAngle: currentSnap.peakAngle,
    activeSide,
    isKneeStraight: currentSnap.isKneeStraight,
    isSupportLegFlat: currentSnap.isSupportLegFlat,
    compensationWarning: currentSnap.compensationWarning,
    holdProgress: currentSnap.holdProgress,
    levelStatus: level,
    videoElement: isDemoMode ? null : videoEl,
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
  cameraPromptOverlay?.classList.add('hidden');
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

// 相機引導遮罩點擊啟用
if (btnStartCameraNow) {
  btnStartCameraNow.addEventListener('click', (e) => {
    e.stopPropagation();
    startCamera();
  });
}

if (cameraPromptOverlay) {
  cameraPromptOverlay.addEventListener('click', () => {
    startCamera();
  });
}

// 主要動作按鈕 (開始 / 重新檢測 / 中途終止重來)
btnMainAction.addEventListener('click', async () => {
  soundManager.unlockAudio();
  const snap = stateManager.getSnapshot();
  if (snap.step === 'IDLE') {
    if (!stream) {
      await startCamera();
    }
    stateManager.startAssessment();
  } else if (snap.step === 'REPORT') {
    modalReport.classList.remove('active');
    stateManager.startAssessment();
  } else {
    // 檢測中途隨時點擊重來
    stateManager.reset(true);
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

// 一鍵清除快取並強制重整
const btnForceRefresh = document.getElementById('btn-force-refresh');
if (btnForceRefresh) {
  btnForceRefresh.addEventListener('click', async () => {
    btnForceRefresh.textContent = '⏳ 清理快取中...';
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (e) {
      console.warn('快取清理錯誤:', e);
    }
    // 跳轉至帶有隨機 timestamp 參數之全新網址強制獲取最新版
    window.location.href = window.location.pathname + '?forceReload=' + Date.now();
  });
}

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

// 註冊 Service Worker (PWA 離線支援與自動更新檢測)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // 檢查是否有背景更新已就緒
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                if (pwaUpdateToast) {
                  pwaUpdateToast.style.display = 'flex';
                }
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('Service Worker 註冊略過:', err);
      });

    if (btnPwaRefresh) {
      btnPwaRefresh.addEventListener('click', () => {
        window.location.reload();
      });
    }

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}

// 檢查是否處於 LINE / FB 等封閉式內建瀏覽器
function checkLineBrowser() {
  const ua = navigator.userAgent.toLowerCase();
  const isLine = ua.includes('line') || ua.includes('fban') || ua.includes('fbav');
  if (isLine && lineNoticeOverlay) {
    lineNoticeOverlay.style.display = 'flex';
    lineNoticeOverlay.classList.add('active');
  }
}

if (btnOpenChrome) {
  btnOpenChrome.addEventListener('click', () => {
    const rawUrl = window.location.href.split('#')[0];
    const cleanUrl = rawUrl.replace(/^https?:\/\//, '');
    window.location.href = `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;end`;
  });
}

// 啟動主流程
async function bootstrap() {
  checkLineBrowser();
  statusPill.textContent = '相機系統準備中...';
  isRunning = true;
  requestAnimationFrame(tick);

  // 1. 優先嘗試非阻塞啟動相機 (若已有權限則瞬間秒開)
  startCamera();

  // 2. 平行非同步載入 MediaPipe 姿態模型 (避免 10MB 下載阻塞相機畫面顯示)
  poseDetector
    .initialize((msg) => {
      if (stateManager.getSnapshot().step === 'IDLE' && !stream) {
        statusPill.textContent = msg;
      }
    })
    .then((ready) => {
      if (ready && stateManager.getSnapshot().step === 'IDLE') {
        statusPill.textContent = '✅ AI 骨架引擎就緒！點擊「開始檢測」進行評估';
      }
    })
    .catch((err) => {
      console.warn('MediaPipe 初始化略過:', err);
    });
}

bootstrap();
