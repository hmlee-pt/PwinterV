import { describe, it, expect } from 'vitest';
import { OneEuroFilter, PointFilter, PoseLandmarksFilter } from '../src/filter';
import { NormalizedLandmark } from '../src/biomechanics';

describe('One-Euro Filter Anti-Jitter Smoothing', () => {
  it('should significantly smooth high-frequency noise for static joints', () => {
    const filter = new OneEuroFilter(0.8, 0.01);
    const baseValue = 50.0;
    const noisySamples = [50.2, 49.7, 50.4, 49.6, 50.3, 49.8, 50.1];
    const smoothed: number[] = [];

    let time = 1000;
    for (const s of noisySamples) {
      smoothed.push(filter.filter(s, time));
      time += 33.3; // ~30 fps
    }

    // The variation in filtered output should be much smaller than raw noise
    const rawDev = Math.max(...noisySamples) - Math.min(...noisySamples);
    const smoothDev = Math.max(...smoothed.slice(2)) - Math.min(...smoothed.slice(2));

    expect(smoothDev).toBeLessThan(rawDev * 0.5);
  });

  it('should adapt and follow fast motion with minimal lag', () => {
    const filter = new OneEuroFilter(0.8, 0.02);
    // Rapid leg lift from 10 to 80
    let time = 0;
    let output = 10;
    for (let angle = 10; angle <= 80; angle += 10) {
      output = filter.filter(angle, time);
      time += 33.3;
    }

    // At the end of the fast ramp, filter output should closely track the target
    expect(output).toBeGreaterThan(65);
  });

  it('should smooth full 33-point landmarks array correctly', () => {
    const poseFilter = new PoseLandmarksFilter();
    const dummyLandmarks: NormalizedLandmark[] = Array.from({ length: 33 }, (_, i) => ({
      x: 0.5 + (i % 2 === 0 ? 0.01 : -0.01),
      y: 0.5 + (i % 2 === 0 ? 0.01 : -0.01),
      visibility: 0.9,
    }));

    const result = poseFilter.filterLandmarks(dummyLandmarks, 1000);
    expect(result.length).toBe(33);
    expect(result[24].x).toBeCloseTo(0.51, 1);
  });
});
