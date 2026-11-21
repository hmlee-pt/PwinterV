/**
 * 語音提示與音訊反饋模組 (Voice Guidance & Audio Feedback)
 * 使用瀏覽器原生 Web Speech API 與 Web Audio API
 */

class SoundManager {
  private isMuted: boolean = false;
  private audioCtx: AudioContext | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private isUnlocked: boolean = false;

  constructor() {
    this.initVoice();
    this.setupGlobalUnlock();
  }

  private initVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      // 優先尋找繁體中文 (zh-TW 或 zh-HK)
      this.voice =
        voices.find((v) => v.lang.includes('zh-TW') || v.lang.includes('zh-HK')) ||
        voices.find((v) => v.lang.startsWith('zh')) ||
        null;
    };

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  /**
   * 監聽使用者觸控或點擊，自動喚醒手機音訊與語音通道 (Android Chrome Autoplay Policy)
   */
  private setupGlobalUnlock() {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      this.unlockAudio();
    };

    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
  }

  public unlockAudio() {
    if (this.isUnlocked) return;
    this.isUnlocked = true;

    // 1. 解鎖 Web Audio Context
    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
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
   * 播放語音提示
   */
  public speak(text: string, force: boolean = false) {
    if (this.isMuted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    // 喚醒語音合成引擎
    try {
      window.speechSynthesis.resume();
    } catch {}

    if (force || window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    if (!this.voice) {
      this.initVoice();
    }
    if (this.voice) {
      utterance.voice = this.voice;
    }
    utterance.lang = 'zh-TW';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onend = () => {
      if (this.activeUtterance === utterance) {
        this.activeUtterance = null;
      }
    };
    utterance.onerror = (e) => {
      console.warn('語音播放異常:', e);
      this.activeUtterance = null;
    };

    this.activeUtterance = utterance;

    // 延遲 25ms 避免被剛發送的 cancel() 競爭中斷 (Chromium 特性)
    setTimeout(() => {
      try {
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('speak 執行異常:', err);
      }
    }, 25);
  }

  /**
   * 播放相機快門截圖音效 (真實相機雙脈衝喀嚓聲)
   */
  public playShutterTone() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;

      // 前簾快門點擊
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(800, now);
      osc1.frequency.exponentialRampToValueAtTime(200, now + 0.04);
      gain1.gain.setValueAtTime(0.35, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.04);

      // 後簾快門釋放
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1100, now + 0.05);
      osc2.frequency.exponentialRampToValueAtTime(300, now + 0.12);
      gain2.gain.setValueAtTime(0.4, now + 0.05);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.05);
      osc2.stop(now + 0.12);
    } catch {}
  }

  /**
   * 播放成功鎖定音效 (輕快高頻雙音)
   */
  public playSuccessTone() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.12);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.0, now + 0.12); // A5
      gain2.gain.setValueAtTime(0.25, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.35);
    } catch {}
  }

  /**
   * 播放倒數短嗶音
   */
  public playCountdownTone(freq: number = 660) {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch {}
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
      osc.frequency.setValueAtTime(329.63, now); // E4
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
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
