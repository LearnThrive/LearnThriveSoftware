// LearnThrive AI voice mode: hands the microphone's samples to the page in blocks of about 43 ms.
// Nothing is kept here and nothing leaves the browser from this file; the page decides what to do with the blocks.
class LearnThriveCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(2048);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let at = 0;
      while (at < channel.length) {
        const take = Math.min(channel.length - at, this.block.length - this.filled);
        this.block.set(channel.subarray(at, at + take), this.filled);
        this.filled += take;
        at += take;
        if (this.filled === this.block.length) {
          const copy = this.block.slice();
          this.port.postMessage(copy, [copy.buffer]);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("learnthrive-capture", LearnThriveCapture);
