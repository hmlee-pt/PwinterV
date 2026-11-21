/**
 * 畫布渲染與骨架視覺化 HUD (Canvas Rendering & HUD Overlay)
 */

import { NormalizedLandmark } from './biomechanics';
import { LevelStatus } from './sensors';

export interface RenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  landmarks: NormalizedLandmark[] | null;
  currentAngle: number;
  peakAngle: number;
  activeSide: 'right' | 'left' | null;
  isKneeStraight: boolean;
  isSupportLegFlat: boolean;
  compensationWarning?: string;
  holdProgress: number;
  levelStatus: LevelStatus;
  videoElement?: HTMLVideoElement | null;
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    // 降級相容不支援 roundRect 之 Android 舊版瀏覽器
    ctx.rect(x, y, w, h);
  }
}
const POSE_CONNECTIONS: [number, number][] = [
  // 軀幹
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  // 右腿
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  // 左腿
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  // 右臂
  [12, 14],
  [14, 16],
  // 左臂
  [11, 13],
  [13, 15],
];

export function renderHUD(rc: RenderContext) {
  const { canvas, ctx, landmarks, currentAngle, peakAngle, activeSide, isKneeStraight, isSupportLegFlat, holdProgress, videoElement } = rc;
  const width = canvas.width;
  const height = canvas.height;

  // 核心改進：若視訊已就緒，直接在 Canvas 底層繪製視訊幀，徹底杜絕 Android 手機層疊黑畫面！
  if (videoElement && videoElement.readyState >= 2) {
    ctx.drawImage(videoElement, 0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  if (!landmarks || landmarks.length < 33) {
    // 尚未偵測到人體時，在畫面中央繪製輔助取景框
    drawFramingGuide(ctx, width, height);
    return;
  }

  // 1. 繪製骨架連線
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';

  for (const [startIdx, endIdx] of POSE_CONNECTIONS) {
    const p1 = landmarks[startIdx];
    const p2 = landmarks[endIdx];

    if (!p1 || !p2 || (p1.visibility && p1.visibility < 0.4) || (p2.visibility && p2.visibility < 0.4)) {
      continue;
    }

    const x1 = p1.x * width;
    const y1 = p1.y * height;
    const x2 = p2.x * width;
    const y2 = p2.y * height;

    // 判斷是否為當前測量目標腿
    const isTargetLeg =
      activeSide === 'right'
        ? (startIdx === 24 && endIdx === 26) || (startIdx === 26 && endIdx === 28)
        : activeSide === 'left'
        ? (startIdx === 23 && endIdx === 25) || (startIdx === 25 && endIdx === 27)
        : false;

    if (isTargetLeg) {
      ctx.strokeStyle = isKneeStraight ? '#10b981' : '#f59e0b'; // 綠色正常 / 橘黃色膝蓋微彎
      ctx.lineWidth = 6;
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 3;
    }

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // 2. 繪製關節關鍵點
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (!p || (p.visibility && p.visibility < 0.4)) continue;

    // 僅突出顯示下肢與軀幹關鍵點 (11, 12, 23, 24, 25, 26, 27, 28)
    const isMajor = [11, 12, 23, 24, 25, 26, 27, 28].includes(i);
    const radius = isMajor ? 6 : 3;

    const px = p.x * width;
    const py = p.y * height;

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, 2 * Math.PI);
    if (isMajor) {
      ctx.fillStyle = '#38bdf8'; // 亮青藍色
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fill();
    }
  }

  // 3. 在目標髖關節處繪製動態角度量角器弧線與標籤
  if (activeSide) {
    const isRight = activeSide === 'right';
    const hip = landmarks[isRight ? 24 : 23];
    const ankle = landmarks[isRight ? 28 : 27];

    if (hip && ankle && hip.visibility && hip.visibility > 0.5) {
      const hx = hip.x * width;
      const hy = hip.y * height;

      // 繪製半徑 60px 的量角圓弧
      ctx.beginPath();
      ctx.arc(hx, hy, 55, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 角度弧度動態填充
      const arcRad = (currentAngle * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(hx, hy, 55, -arcRad, 0, false);
      ctx.strokeStyle = currentAngle >= 75 ? '#10b981' : currentAngle >= 60 ? '#f59e0b' : '#ef4444';
      ctx.lineWidth = 6;
      ctx.stroke();

      // 角度浮動標籤 Badge (加大尺寸與清晰度)
      const badgeText = `${Math.round(currentAngle)}°`;
      ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.beginPath();
      drawRoundRect(ctx, hx - 48, hy - 50, 96, 42, 10);
      ctx.fill();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(badgeText, hx, hy - 29);
    }
  }

  // 4. 若正在自動計時 (holdProgress > 0)，在螢幕上方繪製維持進度條
  if (holdProgress > 0) {
    drawHoldProgress(ctx, width, holdProgress, peakAngle);
  }

  // 5. 代償警告提示
  if (!isKneeStraight || !isSupportLegFlat) {
    drawCompensationAlert(ctx, width, !isKneeStraight ? '抬起腿膝蓋未打直' : '對側支撐腿微彎離地');
  }
}

function drawFramingGuide(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(w * 0.1, h * 0.2, w * 0.8, h * 0.6);
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('請將手機平視對準受測者側面（建議橫向握持，全身入鏡）', w / 2, h / 2);
}

function drawHoldProgress(ctx: CanvasRenderingContext2D, w: number, progress: number, angle: number) {
  const barW = Math.min(320, w * 0.85);
  const barH = 16;
  const x = (w - barW) / 2;
  const y = 80;

  // 背景
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.beginPath();
  drawRoundRect(ctx, x, y, barW, barH, 8);
  ctx.fill();

  // 進度
  const fillW = (barW * progress) / 100;
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  drawRoundRect(ctx, x, y, fillW, barH, 8);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`維持中 (${Math.round(angle)}°) ... 自動鎖定 ${progress}%`, w / 2, y - 10);
}

function drawCompensationAlert(ctx: CanvasRenderingContext2D, w: number, msg: string) {
  ctx.fillStyle = 'rgba(239, 68, 68, 0.92)';
  const boxW = Math.min(340, w * 0.9);
  const boxH = 38;
  const x = (w - boxW) / 2;
  const y = 115;

  ctx.beginPath();
  drawRoundRect(ctx, x, y, boxW, boxH, 8);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`⚠️ 代償警示：${msg}`, w / 2, y + boxH / 2);
}
