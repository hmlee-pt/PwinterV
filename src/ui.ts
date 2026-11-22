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
// 專業臨床運動力學核心連線 (僅保留軀幹與下肢核心力學鏈，過濾頭部與手指等雜亂節點)
const POSE_CONNECTIONS: [number, number][] = [
  // 軀幹核心
  [11, 12], // 雙肩
  [11, 23], // 左側身
  [12, 24], // 右側身
  [23, 24], // 骨盆腰髖
  // 右下肢 (髖 -> 膝 -> 踝 -> 腳跟 -> 腳尖)
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  // 左下肢 (髖 -> 膝 -> 踝 -> 腳跟 -> 腳尖)
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
];

// 需要渲染的關鍵關節點索引 (完全隱藏面部 0-10 與雙手 13-22)
const CLINICAL_KEYPOINTS = [11, 12, 23, 24, 25, 26, 27, 28, 30, 32, 29, 31];

export function renderHUD(rc: RenderContext) {
  const {
    canvas,
    ctx,
    landmarks,
    currentAngle,
    peakAngle,
    activeSide,
    isKneeStraight,
    isSupportLegFlat,
    holdProgress,
    videoElement,
  } = rc;
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

  // 1. 繪製抗鋸齒專業力學連線
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [startIdx, endIdx] of POSE_CONNECTIONS) {
    const p1 = landmarks[startIdx];
    const p2 = landmarks[endIdx];

    if (!p1 || !p2 || (p1.visibility && p1.visibility < 0.35) || (p2.visibility && p2.visibility < 0.35)) {
      continue;
    }

    const x1 = p1.x * width;
    const y1 = p1.y * height;
    const x2 = p2.x * width;
    const y2 = p2.y * height;

    // 判斷是否為當前測量目標腿
    const isTargetLeg =
      activeSide === 'right'
        ? (startIdx === 24 && endIdx === 26) ||
          (startIdx === 26 && endIdx === 28) ||
          (startIdx === 28 && endIdx === 30) ||
          (startIdx === 30 && endIdx === 32)
        : activeSide === 'left'
        ? (startIdx === 23 && endIdx === 25) ||
          (startIdx === 25 && endIdx === 27) ||
          (startIdx === 27 && endIdx === 29) ||
          (startIdx === 29 && endIdx === 31)
        : false;

    if (isTargetLeg) {
      // 目標腿：鮮明霓虹發光線條
      ctx.shadowColor = isKneeStraight ? '#10b981' : '#f59e0b';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = isKneeStraight ? '#10b981' : '#f59e0b'; // 綠色正常 / 橘黃色膝蓋微彎代償
      ctx.lineWidth = 6;
    } else {
      // 支撐腿與軀幹：柔和高對比白青半透明線
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 3.5;
    }

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.shadowBlur = 0; // 重設陰影
  }

  // 2. 繪製關節關鍵點 (只繪製臨床下肢與軀幹，徹底移除臉部跳動雜點)
  for (const idx of CLINICAL_KEYPOINTS) {
    const p = landmarks[idx];
    if (!p || (p.visibility && p.visibility < 0.35)) continue;

    const isTargetLegJoint =
      activeSide === 'right'
        ? [24, 26, 28, 30, 32].includes(idx)
        : activeSide === 'left'
        ? [23, 25, 27, 29, 31].includes(idx)
        : false;

    const px = p.x * width;
    const py = p.y * height;
    const radius = isTargetLegJoint ? 7 : 5;

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, 2 * Math.PI);
    if (isTargetLegJoint) {
      ctx.fillStyle = isKneeStraight ? '#10b981' : '#f59e0b';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.fill();

      // 白色中心圓核
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = '#38bdf8'; // 亮青藍色
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
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
  const isLandscape = w > h;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);

  if (isLandscape) {
    // 橫向模式：人體仰臥橫躺，取景框配合寬螢幕
    ctx.strokeRect(w * 0.08, h * 0.16, w * 0.84, h * 0.68);
  } else {
    // 直立模式：人體仰臥橫躺在直立畫面中段
    ctx.strokeRect(w * 0.06, h * 0.28, w * 0.88, h * 0.44);
  }
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.font = isLandscape ? 'bold 16px sans-serif' : 'bold 17px sans-serif';
  ctx.textAlign = 'center';

  if (isLandscape) {
    ctx.fillText('📱 橫向全螢幕：請退後約 1.5 ~ 2 米（使頭部至腳踝全身入鏡）', w / 2, h / 2 - 10);
  } else {
    ctx.fillText('📱 直立拍攝：請退後約 2.5 ~ 3 米（使頭部至腳踝全身入鏡）', w / 2, h / 2 - 10);
  }

  ctx.font = '13.5px sans-serif';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('維持手機垂直地面 (上方水平儀顯示綠燈)', w / 2, h / 2 + 16);
}

function drawHoldProgress(ctx: CanvasRenderingContext2D, w: number, progress: number, angle: number) {
  const isLandscape = w > 500;
  const barW = Math.min(320, w * 0.85);
  const barH = 16;
  const x = (w - barW) / 2;
  const y = isLandscape ? 56 : 80;

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
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`維持中 (${Math.round(angle)}°) ... 自動鎖定 ${progress}%`, w / 2, y - 8);
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
