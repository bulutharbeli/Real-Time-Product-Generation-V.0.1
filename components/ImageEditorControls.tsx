/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import { Edits } from './types';

interface ImageEditorControlsProps {
  edits: Edits;
  onEditChange: (edits: Edits) => void;
  onApply: () => void;
  onReset: () => void;
  disabled?: boolean;
  isMaskingMode: boolean;
  onToggleMaskingMode: (active: boolean) => void;
  onApplyMask: () => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
}

const ImageEditorControls: React.FC<ImageEditorControlsProps> = ({
  edits,
  onEditChange,
  onApply,
  onReset,
  disabled = false,
  isMaskingMode,
  onToggleMaskingMode,
  onApplyMask,
  brushSize,
  onBrushSizeChange,
}) => {
  const [focusedSlider, setFocusedSlider] = useState<string | null>(null);

  const hasEdits =
    edits.brightness !== 100 ||
    edits.contrast !== 100 ||
    edits.saturation !== 100 ||
    edits.sharpen !== 0 ||
    edits.vignette !== 0;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onEditChange({ ...edits, [name]: parseInt(value, 10) });
  };
  
  const handleBrushSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onBrushSizeChange(parseInt(e.target.value, 10));
  };
  
  const sliderStyle = "w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-blue-600";
  
  if (isMaskingMode) {
    return (
      <div className={`bg-zinc-50 border border-zinc-200 rounded-lg p-4 mt-4 transition-opacity ${disabled ? 'opacity-50 pointer-events-none' : ''}`} aria-labelledby="mask-heading">
        <h3 id="mask-heading" className="text-md font-bold text-center mb-4 text-zinc-700">Remove Object</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="brushSize" className="flex justify-between text-sm font-medium mb-1 text-zinc-600">
              <span>Brush Size</span>
              <span>{brushSize}px</span>
            </label>
            <input
              type="range"
              id="brushSize"
              name="brushSize"
              min="10"
              max="100"
              step="5"
              value={brushSize}
              onChange={handleBrushSizeChange}
              disabled={disabled}
              className={sliderStyle}
              aria-valuetext={`${brushSize}px`}
            />
          </div>
          <p className="text-xs text-zinc-500 text-center">Paint over an object in the scene to remove it.</p>
        </div>
        <div className="flex justify-between items-center mt-6">
          <button
            onClick={() => onToggleMaskingMode(false)}
            disabled={disabled}
            className="text-sm text-zinc-600 hover:text-zinc-800 font-semibold disabled:text-zinc-400 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onApplyMask}
            disabled={disabled}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed"
          >
            Confirm Removal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-zinc-50 border border-zinc-200 rounded-lg p-4 mt-4 transition-opacity ${disabled ? 'opacity-50 pointer-events-none' : ''}`} aria-labelledby="edit-heading">
      <div className="flex justify-between items-center mb-4">
        <h3 id="edit-heading" className="text-md font-bold text-zinc-700">Adjust Scene</h3>
        <button
          onClick={() => onToggleMaskingMode(true)}
          disabled={disabled}
          className="bg-zinc-200 hover:bg-zinc-300 text-zinc-800 font-bold py-1 px-3 rounded-lg text-xs transition-colors"
        >
          Remove Object
        </button>
      </div>
      <div className="space-y-4">
        {/* Brightness */}
        <div>
          <label htmlFor="brightness" className={`flex justify-between text-sm font-medium mb-1 transition-colors ${focusedSlider === 'brightness' ? 'text-blue-600' : 'text-zinc-600'}`}>
            <span>Brightness</span>
            <span>{edits.brightness}%</span>
          </label>
          <input
            type="range"
            id="brightness"
            name="brightness"
            min="0"
            max="200"
            value={edits.brightness}
            onChange={handleSliderChange}
            onFocus={() => setFocusedSlider('brightness')}
            onBlur={() => setFocusedSlider(null)}
            disabled={disabled}
            className={sliderStyle}
            aria-valuetext={`${edits.brightness}%`}
          />
        </div>
        {/* Contrast */}
        <div>
          <label htmlFor="contrast" className={`flex justify-between text-sm font-medium mb-1 transition-colors ${focusedSlider === 'contrast' ? 'text-blue-600' : 'text-zinc-600'}`}>
            <span>Contrast</span>
            <span>{edits.contrast}%</span>
          </label>
          <input
            type="range"
            id="contrast"
            name="contrast"
            min="0"
            max="200"
            value={edits.contrast}
            onChange={handleSliderChange}
            onFocus={() => setFocusedSlider('contrast')}
            onBlur={() => setFocusedSlider(null)}
            disabled={disabled}
            className={sliderStyle}
            aria-valuetext={`${edits.contrast}%`}
          />
        </div>
        {/* Saturation */}
        <div>
          <label htmlFor="saturation" className={`flex justify-between text-sm font-medium mb-1 transition-colors ${focusedSlider === 'saturation' ? 'text-blue-600' : 'text-zinc-600'}`}>
            <span>Saturation</span>
            <span>{edits.saturation}%</span>
          </label>
          <input
            type="range"
            id="saturation"
            name="saturation"
            min="0"
            max="200"
            value={edits.saturation}
            onChange={handleSliderChange}
            onFocus={() => setFocusedSlider('saturation')}
            onBlur={() => setFocusedSlider(null)}
            disabled={disabled}
            className={sliderStyle}
            aria-valuetext={`${edits.saturation}%`}
          />
        </div>
        {/* Sharpen */}
        <div>
           <label htmlFor="sharpen" className={`flex justify-between text-sm font-medium mb-1 transition-colors ${focusedSlider === 'sharpen' ? 'text-blue-600' : 'text-zinc-600'}`}>
            <span>Sharpen</span>
            <span>{edits.sharpen}%</span>
          </label>
          <input
            type="range"
            id="sharpen"
            name="sharpen"
            min="0"
            max="100"
            value={edits.sharpen}
            onChange={handleSliderChange}
            onFocus={() => setFocusedSlider('sharpen')}
            onBlur={() => setFocusedSlider(null)}
            disabled={disabled}
            className={sliderStyle}
            aria-valuetext={`${edits.sharpen}%`}
          />
        </div>
        {/* Vignette */}
        <div>
          <label htmlFor="vignette" className={`flex justify-between text-sm font-medium mb-1 transition-colors ${focusedSlider === 'vignette' ? 'text-blue-600' : 'text-zinc-600'}`}>
            <span>Vignette</span>
            <span>{edits.vignette}%</span>
          </label>
          <input
            type="range"
            id="vignette"
            name="vignette"
            min="0"
            max="100"
            value={edits.vignette}
            onChange={handleSliderChange}
            onFocus={() => setFocusedSlider('vignette')}
            onBlur={() => setFocusedSlider(null)}
            disabled={disabled}
            className={sliderStyle}
            aria-valuetext={`${edits.vignette}%`}
          />
        </div>
      </div>
      <div className="flex justify-between items-center mt-6">
        <button
          onClick={onReset}
          disabled={!hasEdits || disabled}
          className="text-sm text-zinc-600 hover:text-zinc-800 font-semibold disabled:text-zinc-400 disabled:cursor-not-allowed transition-colors"
        >
          Reset
        </button>
        <button
          onClick={onApply}
          disabled={!hasEdits || disabled}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed"
        >
          Apply Edits
        </button>
      </div>
    </div>
  );
};

export default ImageEditorControls;
