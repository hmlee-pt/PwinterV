/**
 * 檢測狀態機與流程管理 (Testing State Machine)
 */

import { evaluateASLR, generateMobilityReport, MobilityRiskReport, NormalizedLandmark } from './biomechanics';
import { soundManager } from './audio';

export type AssessmentStep =
  | 'IDLE'             // 初始準備頁面
  | 'CALIBRATING'      // 相機與水平定位就位中
  | 'MEASURING_RIGHT'  // 測量右腿主動直膝抬腿
  | 'TRANSITION'       // 左右腳交替切換緩衝
  | 'MEASURING_LEFT'   // 測量左腿主動直膝抬腿
  | 'REPORT';          // 產出防受傷報告

export interface StateSnapshot {
  step: AssessmentStep;
  currentAngle: number;
  peakAngle: number;
  rightPeakAngle: number | null;
  leftPeakAngle: number | null;
  rightSnapshotUrl: string | null;
  leftSnapshotUrl: string | null;
  isKneeStraight: boolean;
  isSupportLegFlat: boolean;
  compensationWarning?: string;
  holdProgress: number; // 0 ~ 100 (%) 峰值維持進度
  report: MobilityRiskReport | null;
  statusMessage: string;
}

export class AssessmentStateManager {
  private step: AssessmentStep = 'IDLE';
  private rightPeakAngle: number | null = null;
  private leftPeakAngle: number | null = null;
  private rightSnapshotUrl: string | null = null;
  private leftSnapshotUrl: string | null = null;
  private currentAngle: number = 0;
  private peakAngle: number = 0;
  private isKneeStraight: boolean = true;
  private isSupportLegFlat: boolean = true;
  private compensationWarning?: string;

  // 峰值維持鎖定計時 (Hold Timer) - 依需求設定為 1.5 秒
  private holdStartTime: number = 0;
  private holdThresholdMs: number = 1500;
  private holdProgress: number = 0;

  private report: MobilityRiskReport | null = null;
  private statusMessage: string = '請將鏡頭對準受測者側面';

  // 畫面截圖擷取回調 (由主視訊 Canvas 注入)
  public onCaptureRequest?: (side: 'right' | 'left') => string;

  private listeners: ((snapshot: StateSnapshot) => void)[] = [];

  public subscribe(cb: (snapshot: StateSnapshot) => void) {
    this.listeners.push(cb);
    cb(this.getSnapshot());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify() {
    const snap = this.getSnapshot();
    this.listeners.forEach((cb) => cb(snap));
  }

  public getSnapshot(): StateSnapshot {
    return {
      step: this.step,
      currentAngle: this.currentAngle,
      peakAngle: this.peakAngle,
      rightPeakAngle: this.rightPeakAngle,
      leftPeakAngle: this.leftPeakAngle,
      rightSnapshotUrl: this.rightSnapshotUrl,
      leftSnapshotUrl: this.leftSnapshotUrl,
      isKneeStraight: this.isKneeStraight,
      isSupportLegFlat: this.isSupportLegFlat,
      compensationWarning: this.compensationWarning,
      holdProgress: this.holdProgress,
      report: this.report,
      statusMessage: this.statusMessage,
    };
  }

  public startAssessment() {
    this.step = 'MEASURING_RIGHT';
    this.rightPeakAngle = null;
    this.leftPeakAngle = null;
    this.rightSnapshotUrl = null;
    this.leftSnapshotUrl = null;
    this.currentAngle = 0;
    this.peakAngle = 0;
    this.holdProgress = 0;
    this.holdStartTime = 0;
    this.report = null;
    this.statusMessage = '【第一步：右腿】請受測者保持直膝，緩慢抬起右腿至最高點，維持一秒半';
    soundManager.speak('檢測開始。請受測者保持直膝，緩慢抬起右腿至最高點，維持一秒半。', true);
    this.notify();
  }

  public reset(speakNotice = false) {
    this.step = 'IDLE';
    this.rightPeakAngle = null;
    this.leftPeakAngle = null;
    this.rightSnapshotUrl = null;
    this.leftSnapshotUrl = null;
    this.currentAngle = 0;
    this.peakAngle = 0;
    this.holdProgress = 0;
    this.holdStartTime = 0;
    this.report = null;
    this.statusMessage = '請將鏡頭對準受測者側面';
    if (speakNotice) {
      soundManager.speak('檢測已取消，請準備重新開始。', true);
    }
    this.notify();
  }

  /**
   * 手動點擊拍照快門按鈕直接鎖定當前峰值與截圖 (Manual Capture by Tester)
   */
  public triggerManualLock() {
    if (this.step === 'MEASURING_RIGHT') {
      const angle = Math.max(this.peakAngle, this.currentAngle, 20);
      this.lockRight(angle);
    } else if (this.step === 'MEASURING_LEFT') {
      const angle = Math.max(this.peakAngle, this.currentAngle, 20);
      this.lockLeft(angle);
    }
  }

  private lockRight(angle: number) {
    this.rightPeakAngle = Math.round(angle * 10) / 10;

    // 擷取右腿畫面快照
    if (this.onCaptureRequest) {
      this.rightSnapshotUrl = this.onCaptureRequest('right');
    }

    soundManager.playShutterTone();
    setTimeout(() => soundManager.playSuccessTone(), 160);
    soundManager.vibrate(150);

    this.step = 'TRANSITION';
    this.statusMessage = `📸 右腿已拍照鎖定：${Math.round(this.rightPeakAngle)}°！準備切換左腿...`;
    soundManager.speak(`右腿鎖定成功，${Math.round(this.rightPeakAngle)}度！現在換左腳，請受測者放平，準備做左腿動作。`, true);
    this.notify();

    // 2.5 秒後自動進入左腿檢測
    setTimeout(() => {
      if (this.step === 'TRANSITION') {
        this.step = 'MEASURING_LEFT';
        this.currentAngle = 0;
        this.peakAngle = 0;
        this.holdProgress = 0;
        this.holdStartTime = 0;
        this.statusMessage = '【第二步：左腿】請受測者保持直膝，緩慢抬起左腿至最高點，維持一秒半';
        soundManager.speak('現在請受測者保持直膝，緩慢抬起左腿至最高點，維持一秒半。', true);
        this.notify();
      }
    }, 2500);
  }

  private lockLeft(angle: number) {
    this.leftPeakAngle = Math.round(angle * 10) / 10;

    // 擷取左腿畫面快照
    if (this.onCaptureRequest) {
      this.leftSnapshotUrl = this.onCaptureRequest('left');
    }

    soundManager.playShutterTone();
    setTimeout(() => soundManager.playSuccessTone(), 160);
    soundManager.vibrate([100, 50, 150]);

    this.step = 'REPORT';

    const right = this.rightPeakAngle || 0;
    const left = this.leftPeakAngle;
    const report = generateMobilityReport(right, left);
    report.rightSnapshotUrl = this.rightSnapshotUrl || undefined;
    report.leftSnapshotUrl = this.leftSnapshotUrl || undefined;
    this.report = report;

    this.statusMessage = `檢測完成！FMS得分：${report.fmsTotalScore}分 (右 ${Math.round(right)}° / 左 ${Math.round(left)}°)`;
    soundManager.speak(
      `左腿鎖定成功，${Math.round(left)}度！檢測全部完成，FMS得分：${report.fmsTotalScore}分。正在為您產出評估報告。`,
      true
    );
    this.notify();
  }

  /**
   * 每幀更新骨架姿態
   */
  public updatePose(landmarks: NormalizedLandmark[]) {
    if (this.step !== 'MEASURING_RIGHT' && this.step !== 'MEASURING_LEFT') {
      return;
    }

    const side = this.step === 'MEASURING_RIGHT' ? 'right' : 'left';
    const result = evaluateASLR(landmarks, side);

    if (!result) {
      return;
    }

    this.currentAngle = result.hipFlexionAngle;
    this.isKneeStraight = result.isKneeStraight;
    this.isSupportLegFlat = result.isSupportLegFlat;
    this.compensationWarning = result.compensationWarning;

    // 更新峰值
    if (this.currentAngle > this.peakAngle) {
      this.peakAngle = this.currentAngle;
    }

    // 自動停頓鎖定機制：
    // 若抬腿角度超過 25°，且在當前峰值附近 (差值 <= 3°) 保持停頓
    if (this.currentAngle >= 25 && Math.abs(this.currentAngle - this.peakAngle) <= 3) {
      const now = Date.now();
      if (this.holdStartTime === 0) {
        this.holdStartTime = now;
      }
      const elapsed = now - this.holdStartTime;
      this.holdProgress = Math.min(100, Math.round((elapsed / this.holdThresholdMs) * 100));

      if (elapsed >= this.holdThresholdMs) {
        // 達成維持 1.5 秒，自動拍照並鎖定！
        if (this.step === 'MEASURING_RIGHT') {
          this.lockRight(this.peakAngle);
        } else if (this.step === 'MEASURING_LEFT') {
          this.lockLeft(this.peakAngle);
        }
      }
    } else {
      // 動作波動較大或正在向上抬升，重設停頓計時
      this.holdStartTime = 0;
      this.holdProgress = 0;
    }

    this.notify();
  }
}

export const stateManager = new AssessmentStateManager();
