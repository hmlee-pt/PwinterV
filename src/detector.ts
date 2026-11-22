/**
 * 端側姿態辨識偵測器 (MediaPipe PoseLandmarker Wrapper)
 * 運用 Google 最新 WebAssembly + WebGL 端側推論，零伺服器影像上傳
 */

import { FilesetResolver, PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision';

export class PoseDetector {
  private landmarker: PoseLandmarker | null = null;
  private isInitializing: boolean = false;
  private isReady: boolean = false;
  private initError: string | null = null;

  public async initialize(onProgress?: (msg: string) => void): Promise<boolean> {
    if (this.isReady) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;
    this.initError = null;

    try {
      if (onProgress) onProgress('正在載入 MediaPipe WebAssembly 核心...');
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      if (onProgress) onProgress('正在載入高精度骨架追蹤模型 (Pose Full)...');
      const FULL_MODEL_URL =
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
      const LITE_MODEL_URL =
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

      try {
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: FULL_MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.55,
          minPosePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
      } catch (gpuErr) {
        console.warn('高精度模型 GPU 加速失敗，嘗試降級載入:', gpuErr);
        if (onProgress) onProgress('切換至相容模式載入...');
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: LITE_MODEL_URL,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      }

      this.isReady = true;
      if (onProgress) onProgress('AI 骨架偵測引擎就緒！');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.initError = msg;
      console.error('MediaPipe 初始化失敗:', err);
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  public getIsReady(): boolean {
    return this.isReady;
  }

  public getError(): string | null {
    return this.initError;
  }

  /**
   * 對視訊幀進行姿態偵測
   */
  public detect(videoElement: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult | null {
    if (!this.landmarker || !this.isReady || videoElement.readyState < 2) {
      return null;
    }

    try {
      return this.landmarker.detectForVideo(videoElement, timestampMs);
    } catch (e) {
      console.warn('偵測幀異常:', e);
      return null;
    }
  }
}

export const poseDetector = new PoseDetector();
