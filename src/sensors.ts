/**
 * 手機姿態感測與電子水平儀 (Device Orientation & Digital Inclinometer)
 * 用於協助施測者手持手機時維持平視垂直視角，避免透視俯仰角誤差
 */

export interface LevelStatus {
  isSupported: boolean;
  isPermissionGranted: boolean;
  isLevel: boolean;         // 是否處於建議的平視垂直範圍內
  pitch: number;           // 前後傾角 (度)
  roll: number;            // 左右側傾角 (度)
  deviation: number;       // 偏離標準角度的綜合差值
  statusText: string;      // 狀態提示文字
  color: string;           // 狀態燈顏色 (green, yellow, red)
}

class InclinometerSensor {
  private isSupported: boolean = false;
  private isPermissionGranted: boolean = false;
  private pitch: number = 90;
  private roll: number = 0;
  private isListening: boolean = false;

  constructor() {
    this.checkSupport();
  }

  private checkSupport() {
    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      this.isSupported = true;
    }
  }

  /**
   * 請求 iOS 13+ 陀螺儀存取授權 (必須由使用者點擊按鈕觸發)
   */
  public async requestPermission(): Promise<boolean> {
    if (!this.isSupported) return false;

    const DeviceOrientation = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    if (typeof DeviceOrientation.requestPermission === 'function') {
      try {
        const response = await DeviceOrientation.requestPermission();
        this.isPermissionGranted = response === 'granted';
        if (this.isPermissionGranted) {
          this.startListening();
        }
        return this.isPermissionGranted;
      } catch (err) {
        console.warn('陀螺儀授權失敗:', err);
        return false;
      }
    } else {
      // 非 iOS 或無須明確授權之環境
      this.isPermissionGranted = true;
      this.startListening();
      return true;
    }
  }

  public startListening() {
    if (this.isListening || !this.isSupported) return;
    window.addEventListener('deviceorientation', this.handleOrientation, true);
    this.isListening = true;
  }

  public stopListening() {
    if (!this.isListening) return;
    window.removeEventListener('deviceorientation', this.handleOrientation, true);
    this.isListening = false;
  }

  private handleOrientation = (event: DeviceOrientationEvent) => {
    if (event.beta !== null) {
      this.pitch = Math.round(event.beta);
    }
    if (event.gamma !== null) {
      this.roll = Math.round(event.gamma);
    }
  };

  /**
   * 取得當前手持水平儀狀態
   * 最佳標準：平視側面拍攝時，手機垂直地面 (Pitch ~ 80°-100°，Roll ~ -8°~+8°)
   */
  public getStatus(): LevelStatus {
    if (!this.isSupported) {
      return {
        isSupported: false,
        isPermissionGranted: false,
        isLevel: true, // 降級環境預設放行
        pitch: 90,
        roll: 0,
        deviation: 0,
        statusText: '感測器未啟用 (已自動適應)',
        color: '#10b981',
      };
    }

    // 檢查直立與水平偏離
    // Pitch 理想值在 85° ~ 95° 之間 (垂直立起平視)
    const pitchDiff = Math.abs(this.pitch - 90);
    // Roll 理想值在 -8° ~ 8° 之間
    const rollDiff = Math.abs(this.roll);

    const totalDeviation = Math.round(Math.sqrt(pitchDiff * pitchDiff + rollDiff * rollDiff));
    const isLevel = totalDeviation <= 12;

    let statusText = '綠燈：鏡頭視角平正';
    let color = '#10b981'; // 綠色

    if (totalDeviation > 25) {
      statusText = '紅燈：手機傾斜過大，請拿正平視';
      color = '#ef4444'; // 紅色
    } else if (totalDeviation > 12) {
      statusText = '黃燈：微偏，請盡量垂直平視受測者';
      color = '#f59e0b'; // 黃色
    }

    return {
      isSupported: this.isSupported,
      isPermissionGranted: this.isPermissionGranted,
      isLevel,
      pitch: this.pitch,
      roll: this.roll,
      deviation: totalDeviation,
      statusText,
      color,
    };
  }
}

export const inclinometerSensor = new InclinometerSensor();
