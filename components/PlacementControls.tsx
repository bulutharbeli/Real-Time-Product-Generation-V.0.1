/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';

interface PlacementControlsProps {
  scale: number;
  onScaleChange: (newScale: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  disabled: boolean;
}

const PlacementControls: React.FC<PlacementControlsProps> = ({
  scale,
  onScaleChange,
  onConfirm,
  onCancel,
  disabled,
}) => {
  const displayScale = Math.round(scale * 100);

  return (
    <div className={`bg-zinc-50 border border-zinc-200 rounded-lg p-4 w-full max-w-lg mx-auto animate-fade-in transition-opacity ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <h3 className="text-md font-bold text-center mb-4 text-zinc-700">Adjust Placement</h3>
      <div className="space-y-4">
        <div>
          <label htmlFor="scale" className="flex justify-between text-sm font-medium mb-1 text-zinc-600">
            <span>Scale</span>
            <span>{displayScale}%</span>
          </label>
          <input
            type="range"
            id="scale"
            name="scale"
            min="0.25"
            max="2.5"
            step="0.05"
            value={scale}
            onChange={(e) => onScaleChange(parseFloat(e.target.value))}
            disabled={disabled}
            className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            aria-valuetext={`${displayScale}%`}
          />
        </div>
        <p className="text-xs text-zinc-500 text-center">Drag the product to move it, or use two fingers to resize on touch screens.</p>
      </div>
      <div className="flex justify-between items-center mt-6">
        <button
          onClick={onCancel}
          disabled={disabled}
          className="text-sm text-zinc-600 hover:text-zinc-800 font-semibold disabled:text-zinc-400 disabled:cursor-not-allowed transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed"
        >
          Generate Scene
        </button>
      </div>
    </div>
  );
};

export default PlacementControls;