/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface Product {
  id: number;
  name: string;
  imageUrl: string;
}

export interface Edits {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  vignette: number;
}

export interface ImageUploaderRef {
  getMaskAsFile: () => Promise<File | null>;
  getDisplayCanvas: () => HTMLCanvasElement | null;
}
