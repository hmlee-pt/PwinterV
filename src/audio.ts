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

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    if (this.isMuted || !('speechSynthesis' in window)) return;

    if (force) {
      window.speechSynthesis.cancel();
    } else if (window.speechSynthesis.speaking) {
      // 若上一句還在講且非強制，則不中斷
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) {
      utterance.voice = this.voice;
    }
    utterance.lang = 'zh-TW';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.onend = () => {
      if (this.activeUtterance === utterance) {
        this.activeUtterance = null;
      }
    };
    this.activeUtterance = utterance;
    window.speechSynthesis.speak(utterance);
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
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.12);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.0, now + 0.12); // A5
      gain2.gain.setValueAtTime(0.2, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.35);
    } catch {
      // 容錯降級
    }
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
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch {
      // 容錯降級
    }
  }

  /**
   * 觸發手機震動 (Haptic Feedback)
   */
  public vibrate(pattern: number | number[] = 100) {
    if ('navigator' in window && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // 忽略不支援環境
      }
    }
  }
}

export const soundManager = new SoundManager();
