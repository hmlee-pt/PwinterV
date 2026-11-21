/**
 * 語音提示與音訊反饋模組 (Voice Guidance & Audio Feedback)
 * 使用瀏覽器原生 Web Speech API 與 Web Audio API
 */

class SoundManager {
  private isMuted: boolean = false;
  private audioCtx: AudioContext | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    this.initVoice();
    this.setupGlobalUnlock();
  }

  private initVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const loadVoices = () => {
      try {
        const voices = window.speechSynthesis.getVoices();
        if (!voices || voices.length === 0) return;

        // 優先尋找繁體中文 (zh-TW 或 zh-HK)，其次簡體中文或通用中文
        this.voice =
          voices.find((v) => {
            const lang = v.lang.replace('_', '-').toLowerCase();
            return lang.includes('zh-tw') || lang.includes('zh-hk');
          }) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('zh')) ||
          voices[0] ||
          null;
      } catch (err) {
        console.warn('載入語音套件失敗:', err);
      }
    };

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  /**
   * 監聽使用者觸控或點擊，自動喚醒手機音訊與語音通道 (Android Chrome Autoplay Policy)
   * 採持續檢測：每次點擊都確保 AudioContext 保持 running 狀態
   */
  private setupGlobalUnlock() {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      this.unlockAudio();
    };

    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('pointerdown', unlock, { passive: true });
  }

  public unlockAudio() {
    // 1. 解鎖 Web Audio Context
    try {
      const ctx = this.getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume();
      }
    } catch {}

    // 2. 解鎖 Web Speech Synthesis (修復 Android Chrome 假死狀態)
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
      } catch {}
    }
  }

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  /**
   * 播放語音提示 (具備防垃圾回收與多重備援)
   */
  public speak(text: string, force: boolean = false) {
    if (this.isMuted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    // 喚醒語音合成引擎
    try {
      window.speechSynthesis.resume();
    } catch {}

    if (force || window.speechSynthesis.speaking) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

    const utterance = new SpeechSynthesisUtterance(text);
    if (!this.voice) {
      this.initVoice();
    }
    if (this.voice) {
      utterance.voice = this.voice;
      utterance.lang = this.voice.lang;
    } else {
      utterance.lang = 'zh-TW';
    }

    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.volume = 1.0; // 最高音量

    utterance.onend = () => {
      if (this.activeUtterance === utterance) {
        this.activeUtterance = null;
      }
    };
    utterance.onerror = (e) => {
      console.warn('語音播放異常 (系統將使用硬體蜂鳴音效備援):', e);
      this.activeUtterance = null;
    };

    // 關鍵修復：掛載到全域 window 防止被 Chromium V8 引擎作為垃圾回收提早中止
    this.activeUtterance = utterance;
    (window as unknown as { __activeUtterance?: SpeechSynthesisUtterance }).__activeUtterance = utterance;

    // 延遲 40ms 避免與剛發送的 cancel() 競爭中斷
    setTimeout(() => {
      try {
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('speak 執行異常:', err);
      }
    }, 40);
  }

  /**
   * 播放相機快門截圖音效 (真實相機高音量雙脈衝喀嚓聲)
   */
  public playShutterTone() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;

      // 前簾快門點擊 (清脆高頻拍擊)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(950, now);
      osc1.frequency.exponentialRampToValueAtTime(180, now + 0.05);
      gain1.gain.setValueAtTime(0.85, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.05);

      // 後簾快門釋放 (重低音鎖定聲)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(1200, now + 0.055);
      osc2.frequency.exponentialRampToValueAtTime(220, now + 0.16);
      gain2.gain.setValueAtTime(0.8, now + 0.055);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.055);
      osc2.stop(now + 0.16);
    } catch (err) {
      console.warn('快門音效播放失敗:', err);
    }
  }

  /**
   * 播放成功鎖定音效 (高音量清脆琶音和弦)
   */
  public playSuccessTone() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;

      const chord = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.06;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.65, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.22);
      });
    } catch {}
  }

  /**
   * 播放倒數短嗶音 (清脆高頻嗶聲)
   */
  public playCountdownTone(freq: number = 880) {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.65, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  }

  /**
   * 播放最高點維持進度滴答音 (隨著維持進度提高音調)
   */
  public playHoldProgressTick(progress: number) {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const baseFreq = 520 + (progress / 100) * 360; // 520Hz 升至 880Hz
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      gain.gain.setValueAtTime(0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    } catch {}
  }

  /**
   * 測試音效與語音 (點擊喇叭按鈕時立即響亮發聲)
   */
  public testSoundAndVoice() {
    this.unlockAudio();
    this.playSuccessTone();
    setTimeout(() => {
      this.speak('音效與語音已就緒，音量正常！', true);
    }, 280);
  }

  /**
   * 播放警告警示音效 (低頻雙嗶)
   */
  public playWarningTone() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(340, now);
      gain.gain.setValueAtTime(0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } catch {}
  }

  /**
   * 觸發手機震動 (Haptic Feedback)
   */
  public vibrate(pattern: number | number[] = 100) {
    if ('navigator' in window && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  }
}

export const soundManager = new SoundManager();
