/**
 * 1€ Filter (One-Euro Filter) 智慧防手震與動態抗抖濾波器
 * 依據 Casiez et al. (CHI 2012) 演算法實作
 * 專門用於解決人體姿勢辨識 (MediaPipe) 關節座標高頻抖動問題：
 * - 當肢體靜止或緩慢移動時：自動降低截止頻率，徹底消除微幅抖動 (Zero Jitter)
 * - 當肢體快速運動時：自動提高截止頻率，保證零延遲跟隨 (Zero Lag)
 */

import { NormalizedLandmark } from './biomechanics';

class LowPassFilter {
  private s: number | null = null;

  public filter(value: number, alpha: number): number {
    if (this.s === null) {
      this.s = value;
      return value;
    }
    this.s = alpha * value + (1.0 - alpha) * this.s;
    return this.s;
  }

  public lastValue(): number {
    return this.s ?? 0;
  }

  public reset() {
    this.s = null;
  }
}

export class OneEuroFilter {
  private minCutoff: number; // 靜止時最小截止頻率 (Hz)
  private beta: number;      // 速度自適應增益係數
  private dCutoff: number;   // 速度導數截止頻率 (Hz)
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTime: number | null = null;
  private lastRawX: number | null = null;

  constructor(minCutoff: number = 0.8, beta: number = 0.015, dCutoff: number = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(rate: number, cutoff: number): number {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    const te = 1.0 / rate;
    return 1.0 / (1.0 + tau / te);
  }

  public filter(x: number, timestampMs: number): number {
    if (this.lastTime === null || this.lastRawX === null) {
      this.lastTime = timestampMs;
      this.lastRawX = x;
      return this.xFilter.filter(x, 1.0);
    }

    const dt = Math.max((timestampMs - this.lastTime) / 1000.0, 1e-4);
    this.lastTime = timestampMs;
    const rate = 1.0 / dt;

    // 計算瞬時速度變化
    const dx = (x - this.lastRawX) * rate;
    this.lastRawX = x;
    const edx = this.dxFilter.filter(dx, this.alpha(rate, this.dCutoff));

    // 動態調整截止頻率：靜止時接近 minCutoff，高速運動時增大
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(x, this.alpha(rate, cutoff));
  }

  public reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
    this.lastRawX = null;
  }
}

/**
 * 2D 關節點平滑濾波器
 */
export class PointFilter {
  private filterX: OneEuroFilter;
  private filterY: OneEuroFilter;

  constructor(minCutoff: number = 0.7, beta: number = 0.01) {
    this.filterX = new OneEuroFilter(minCutoff, beta);
    this.filterY = new OneEuroFilter(minCutoff, beta);
  }

  public filter(x: number, y: number, timestampMs: number): { x: number; y: number } {
    return {
      x: this.filterX.filter(x, timestampMs),
      y: this.filterY.filter(y, timestampMs),
    };
  }

  public reset() {
    this.filterX.reset();
    this.filterY.reset();
  }
}

/**
 * 人體姿態 33 關鍵點全域平滑管理
 */
export class PoseLandmarksFilter {
  private pointFilters: Map<number, PointFilter> = new Map();

  public filterLandmarks(
    landmarks: NormalizedLandmark[],
    timestampMs: number
  ): NormalizedLandmark[] {
    return landmarks.map((lm, idx) => {
      let filter = this.pointFilters.get(idx);
      if (!filter) {
        // 下肢重要關節 (髖 23/24, 膝 25/26, 踝 27/28) 設定最佳平滑參數
        const isLegJoint = idx >= 23 && idx <= 32;
        filter = new PointFilter(isLegJoint ? 0.6 : 0.8, isLegJoint ? 0.008 : 0.015);
        this.pointFilters.set(idx, filter);
      }

      const smoothed = filter.filter(lm.x, lm.y, timestampMs);
      return {
        ...lm,
        x: smoothed.x,
        y: smoothed.y,
      };
    });
  }

  public reset() {
    this.pointFilters.forEach((f) => f.reset());
    this.pointFilters.clear();
  }
}

export const poseFilter = new PoseLandmarksFilter();
