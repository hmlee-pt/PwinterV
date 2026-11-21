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

// 相機引導遮罩元件
const cameraPromptOverlay = document.getElementById('camera-prompt-overlay') as HTMLElement;
const btnStartCameraNow = document.getElementById('btn-start-camera-now') as HTMLButtonElement;

// 橫向持機與 PWA 更新提示
const autoRotateNotice = document.getElementById('auto-rotate-notice') as HTMLElement;
const pwaUpdateToast = document.getElementById('pwa-update-toast') as HTMLElement;
const btnPwaRefresh = document.getElementById('btn-pwa-refresh') as HTMLButtonElement;

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

  // 1.1 檢測是否物理橫放但螢幕處於直向鎖定
  const isScreenPortrait = window.innerWidth < window.innerHeight;
  if (autoRotateNotice) {
    if (level.isHoldingLandscape && isScreenPortrait) {
      autoRotateNotice.style.display = 'block';
    } else {
      autoRotateNotice.style.display = 'none';
    }
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

// 啟動主流程
async function bootstrap() {
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
