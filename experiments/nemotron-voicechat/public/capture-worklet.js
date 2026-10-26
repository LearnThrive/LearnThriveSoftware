/**
 * Captures microphone blocks for the experiment page. A copy of the shape LearnThrive AI's own voice mode uses
 * (apps/web/public/audio/capture-worklet.js) — copied on purpose, so the experiment cannot break the app by changing
 * a file the app shares. Posts each block to the page with the context's own sample rate, and the page resamples.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = 2048;
    this.buffer = new Float32Array(this.block);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.filled] = channel[i];
      this.filled += 1;
      if (this.filled === this.block) {
        // Send a copy and hand its buffer over, so the capture buffer keeps being reused without allocation.
        const out = this.buffer.slice(0);
        this.port.postMessage(out, [out.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
