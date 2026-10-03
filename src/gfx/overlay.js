// CPU-side 2D overlay buffer (palette indices, 0 = transparent) the size of the index buffer.
// Uploaded every frame with texSubImage2D into a fixed-size texture (no reallocation).

export class Overlay {
  /** @param {number} w @param {number} h */
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
  }

  clear() {
    this.data.fill(0);
  }
}
