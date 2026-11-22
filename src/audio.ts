/**
 * 語音提示與音訊反饋模組 (Voice Guidance & Audio Feedback)
 * 雙軌架構：
 * 1. 實體預錄語音檔 (Decoded AudioBuffer) -> 透過 Web Audio 播放，100% 相容無 TTS 語音包之 Android 裝置
 * 2. 備援語音合成 (Web Speech API) -> 支援動態即時旁白
 * 3. 硬體級合成音效 (Synthesizer Oscillators) -> 快門聲、倒數音、成功琶音和弦
 */

export type VoiceClip =
  | 'autostart'
  | 'right_leg'
  | 'right_locked'
  | 'left_leg'
  | 'finished'
  | 'test_ready'
  | 'cancelled'
  | 'level_ok'
  | 'level_tilt';

class SoundManager {
  private isMuted: boolean = false;
  private audioCtx: AudioContext | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private audioBuffers: Map<VoiceClip, AudioBuffer> = new Map();

  constructor() {
    this.initVoice();
    this.setupGlobalUnlock();
    this.preloadAudioClips();
  }

  /**
   * 預先載入預錄繁體中文語音音檔 (保證零延遲、無需依賴手機 TTS 引擎)
   */
  private async preloadAudioClips() {
    if (typeof window === 'undefined') return;

    const clips: VoiceClip[] = [
      'autostart',
      'right_leg',
      'right_locked',
      'left_leg',
      'finished',
      'test_ready',
      'cancelled',
      'level_ok',
      'level_tilt',
    ];

    const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
    const baseUrl = metaEnv?.BASE_URL || './';
    const audioDir = baseUrl.endsWith('/') ? `${baseUrl}audio/` : `${baseUrl}/audio/`;

    for (const clip of clips) {
      try {
        const url = `${audioDir}${clip}.wav`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const arrayBuffer = await res.arrayBuffer();
        const ctx = this.getAudioContext();
        ctx.decodeAudioData(
          arrayBuffer,
          (decoded) => {
            this.audioBuffers.set(clip, decoded);
          },
          (err) => {
            console.warn(`音訊解碼失敗 (${clip}):`, err);
          }
        );
      } catch (err) {
        console.warn(`載入音訊檔失敗 (${clip}):`, err);
      }
    }
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
   * 播放已解碼之實體真人語音檔案 (100% 繞過 Android TTS 缺失問題)
   */
  public playVoiceClip(clip: VoiceClip): boolean {
    if (this.isMuted) return false;
    this.unlockAudio();
    const ctx = this.getAudioContext();
    const buffer = this.audioBuffers.get(clip);
    if (!buffer) return false;

    try {
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1.0, ctx.currentTime);
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
      return true;
    } catch (err) {
      console.warn(`播放音訊檔異常 (${clip}):`, err);
      return false;
    }
  }

  private matchClip(text: string): VoiceClip | null {
    if (text.includes('三、二、一') || text.includes('條件符合')) return 'autostart';
    if (text.includes('右腿鎖定') || (text.includes('右腿') && (text.includes('換左') || text.includes('換左腳')))) return 'right_locked';
    if (text.includes('第一步') || (text.includes('抬起右腿') && text.includes('最高點'))) return 'right_leg';
    if (text.includes('第二步') || (text.includes('抬起左腿') && text.includes('最高點'))) return 'left_leg';
    if (text.includes('全部完成') || text.includes('評估報告')) return 'finished';
    if (text.includes('音效與語音已就緒') || text.includes('音量正常')) return 'test_ready';
    if (text.includes('取消') || text.includes('重新開始')) return 'cancelled';
    if (text.includes('視角平正') || text.includes('全身已入鏡')) return 'level_ok';
    if (text.includes('手機拿正') || text.includes('平視')) return 'level_tilt';
    return null;
  }

  /**
   * 播放語音提示 (雙軌制：實體預錄語音優先，TTS 降級備援)
   */
  public speak(text: string, force: boolean = false) {
    if (this.isMuted || typeof window === 'undefined') return;

    // 1. 優先嘗試播放實體真人語音音訊檔
    const clipKey = this.matchClip(text);
    if (clipKey && this.audioBuffers.has(clipKey)) {
      const success = this.playVoiceClip(clipKey);
      if (success) return;
    }

    // 2. 備援方案：瀏覽器原生 TTS 語音合成
    if (!('speechSynthesis' in window)) return;

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

    // 掛載到全域 window 防止被 Chromium V8 引擎提早垃圾回收
    this.activeUtterance = utterance;
    (window as unknown as { __activeUtterance?: SpeechSynthesisUtterance }).__activeUtterance = utterance;

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
      if (!this.playVoiceClip('test_ready')) {
        this.speak('音效與語音已就緒，音量正常！', true);
      }
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
