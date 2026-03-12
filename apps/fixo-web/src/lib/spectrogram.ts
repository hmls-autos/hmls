/**
 * Client-side spectrogram generator for car noise diagnosis.
 * Generates a PNG spectrogram from an audio blob using Web Audio API + Canvas.
 */

export interface SpectrogramResult {
  base64: string;
  blob: Blob;
}

// Self-contained radix-2 FFT (Cooley-Tukey)
function fft(
  re: Float64Array,
  im: Float64Array,
  n: number,
): { re: Float64Array; im: Float64Array } {
  if (n <= 1) return { re, im };

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterfly operations
  for (let len = 2; len <= n; len *= 2) {
    const half = len / 2;
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  return { re, im };
}

// Hann window function
function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

// Heatmap color: amplitude [0,1] → [r,g,b]
function heatmapColor(v: number): [number, number, number] {
  // Dark blue → cyan → yellow → red → white
  if (v < 0.25) {
    const t = v / 0.25;
    return [0, Math.round(t * 128), Math.round(64 + t * 191)];
  }
  if (v < 0.5) {
    const t = (v - 0.25) / 0.25;
    return [Math.round(t * 255), Math.round(128 + t * 127), Math.round(255 - t * 55)];
  }
  if (v < 0.75) {
    const t = (v - 0.5) / 0.25;
    return [255, Math.round(255 - t * 128), Math.round(200 - t * 200)];
  }
  const t = (v - 0.75) / 0.25;
  return [255, Math.round(127 - t * 127), 0];
}

export async function generateSpectrogram(
  audioBlob: Blob,
): Promise<SpectrogramResult> {
  const arrayBuffer = await audioBlob.arrayBuffer();

  // Decode audio
  const offlineCtx = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
  const samples = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  // STFT parameters
  const fftSize = 2048;
  const hopSize = 512;
  const window = hannWindow(fftSize);

  // Frequency range: 20Hz–8kHz
  const minFreq = 20;
  const maxFreq = 8000;
  const minBin = Math.floor((minFreq * fftSize) / sampleRate);
  const maxBin = Math.min(
    Math.ceil((maxFreq * fftSize) / sampleRate),
    fftSize / 2,
  );
  const numBins = maxBin - minBin;

  // Compute spectrogram frames
  const numFrames = Math.max(1, Math.floor((samples.length - fftSize) / hopSize) + 1);
  const magnitudes: Float64Array[] = [];

  let globalMax = 0;
  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * hopSize;
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);

    for (let i = 0; i < fftSize; i++) {
      re[i] = (offset + i < samples.length ? samples[offset + i] : 0) * window[i];
    }

    fft(re, im, fftSize);

    const mag = new Float64Array(numBins);
    for (let b = 0; b < numBins; b++) {
      const bin = b + minBin;
      const m = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
      // Convert to dB scale
      mag[b] = 20 * Math.log10(Math.max(m, 1e-10));
      if (mag[b] > globalMax) globalMax = mag[b];
    }
    magnitudes.push(mag);
  }

  // Normalize to 0–1
  const globalMin = globalMax - 80; // 80 dB dynamic range
  for (const mag of magnitudes) {
    for (let b = 0; b < numBins; b++) {
      mag[b] = Math.max(0, Math.min(1, (mag[b] - globalMin) / (globalMax - globalMin)));
    }
  }

  // Canvas dimensions
  const labelLeft = 50;
  const labelBottom = 30;
  const spectWidth = Math.min(numFrames, 800);
  const spectHeight = Math.min(numBins, 300);
  const canvasWidth = spectWidth + labelLeft + 10;
  const canvasHeight = spectHeight + labelBottom + 20;

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Draw spectrogram
  const imgData = ctx.createImageData(spectWidth, spectHeight);
  const xScale = numFrames / spectWidth;

  for (let x = 0; x < spectWidth; x++) {
    const frame = Math.min(Math.floor(x * xScale), numFrames - 1);
    const mag = magnitudes[frame];
    for (let y = 0; y < spectHeight; y++) {
      // Flip Y: low freq at bottom
      const bin = Math.min(Math.floor(((spectHeight - 1 - y) / spectHeight) * numBins), numBins - 1);
      const val = mag[bin];
      const [r, g, b] = heatmapColor(val);
      const idx = (y * spectWidth + x) * 4;
      imgData.data[idx] = r;
      imgData.data[idx + 1] = g;
      imgData.data[idx + 2] = b;
      imgData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, labelLeft, 10);

  // Axis labels
  ctx.fillStyle = "#fff";
  ctx.font = "11px monospace";
  ctx.textAlign = "right";

  // Y-axis: frequency labels
  const freqLabels = [100, 500, 1000, 2000, 4000, 8000];
  for (const freq of freqLabels) {
    if (freq < minFreq || freq > maxFreq) continue;
    const ratio = (freq - minFreq) / (maxFreq - minFreq);
    const y = 10 + spectHeight - Math.round(ratio * spectHeight);
    ctx.fillText(`${freq >= 1000 ? `${freq / 1000}k` : freq} Hz`, labelLeft - 4, y + 4);
    // Grid line
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(labelLeft, y);
    ctx.lineTo(labelLeft + spectWidth, y);
    ctx.stroke();
  }

  // X-axis: time labels
  const totalDuration = samples.length / sampleRate;
  ctx.textAlign = "center";
  const numTimeLabels = Math.min(6, Math.floor(totalDuration));
  for (let i = 0; i <= numTimeLabels; i++) {
    const t = (i / numTimeLabels) * totalDuration;
    const x = labelLeft + Math.round((i / numTimeLabels) * spectWidth);
    ctx.fillText(`${t.toFixed(1)}s`, x, canvasHeight - 8);
  }

  // Title
  ctx.textAlign = "center";
  ctx.font = "10px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText("Vehicle Sound Spectrogram", canvasWidth / 2, canvasHeight - 0);

  // Export
  const pngBase64 = canvas.toDataURL("image/png").split(",")[1];

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), "image/png");
  });

  return { base64: pngBase64, blob };
}
