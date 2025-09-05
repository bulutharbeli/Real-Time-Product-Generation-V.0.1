/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Spinner from './Spinner';

interface BackgroundRemovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageFile: File | null;
  onConfirm: (maskFile: File) => void;
  isProcessing: boolean;
}

const CloseIcon = () => (
    <svg xmlns="http://www.w.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const BackgroundRemovalModal: React.FC<BackgroundRemovalModalProps> = ({ isOpen, onClose, imageFile, onConfirm, isProcessing }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [brushSize, setBrushSize] = useState(40);
    const [isDrawing, setIsDrawing] = useState(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
        if (imageFile) {
            const objectUrl = URL.createObjectURL(imageFile);
            setImageUrl(objectUrl);
            return () => URL.revokeObjectURL(objectUrl);
        } else {
            // Clear canvas when modal is closed or file is null
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            setImageUrl(null);
        }
    }, [imageFile]);
    
    const handleImageLoad = () => {
        const image = imageRef.current;
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!image || !canvas || !container) return;

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        const imgAspectRatio = image.naturalWidth / image.naturalHeight;
        const containerAspectRatio = containerWidth / containerHeight;

        let renderWidth, renderHeight;
        if (imgAspectRatio > containerAspectRatio) {
            renderWidth = containerWidth;
            renderHeight = containerWidth / imgAspectRatio;
        } else {
            renderHeight = containerHeight;
            renderWidth = containerHeight * imgAspectRatio;
        }

        image.style.width = `${renderWidth}px`;
        image.style.height = `${renderHeight}px`;

        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.style.width = `${renderWidth}px`;
        canvas.style.height = `${renderHeight}px`;
    };

    const getPointInCanvas = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY,
        };
    }, []);

    const handleDrawingStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (isProcessing) return;
        setIsDrawing(true);
        const point = getPointInCanvas(
            'touches' in e ? e.touches[0].clientX : e.clientX,
            'touches' in e ? e.touches[0].clientY : e.clientY
        );
        lastPointRef.current = point;
    }, [isProcessing, getPointInCanvas]);

    const handleDrawingMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || isProcessing) return;
        e.preventDefault();
        
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        const currentPoint = getPointInCanvas(
            'touches' in e ? e.touches[0].clientX : e.clientX,
            'touches' in e ? e.touches[0].clientY : e.clientY
        );

        if (ctx && lastPointRef.current && currentPoint) {
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
            ctx.lineWidth = brushSize * (canvas.width / canvas.getBoundingClientRect().width);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.beginPath();
            ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
            ctx.lineTo(currentPoint.x, currentPoint.y);
            ctx.stroke();
            
            lastPointRef.current = currentPoint;
        }
    }, [isDrawing, isProcessing, brushSize, getPointInCanvas]);

    const handleDrawingEnd = useCallback(() => {
        setIsDrawing(false);
        lastPointRef.current = null;
    }, []);

    const handleConfirm = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const bwCanvas = document.createElement('canvas');
        bwCanvas.width = canvas.width;
        bwCanvas.height = canvas.height;
        const bwCtx = bwCanvas.getContext('2d');
        if (!bwCtx) return;

        const originalCtx = canvas.getContext('2d', { willReadFrequently: true });
        if (!originalCtx) return;

        const imageData = originalCtx.getImageData(0, 0, canvas.width, canvas.height);
        const newImageData = bwCtx.createImageData(canvas.width, canvas.height);
        const data = imageData.data;
        const newData = newImageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha > 0) { // Painted area -> White
                newData[i] = 255; newData[i + 1] = 255; newData[i + 2] = 255; newData[i + 3] = 255;
            } else { // Unpainted area -> Black
                newData[i] = 0; newData[i + 1] = 0; newData[i + 2] = 0; newData[i + 3] = 255;
            }
        }
        bwCtx.putImageData(newImageData, 0, 0);

        bwCanvas.toBlob(blob => {
            if (blob) {
                onConfirm(new File([blob], 'mask.png', { type: 'image/png' }));
            }
        }, 'image/png');
    };

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4 animate-fade-in"
            onClick={onClose}
            aria-modal="true"
            role="dialog"
        >
            <div 
                className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] p-4 md:p-6 relative transform transition-all flex flex-col"
                onClick={(e) => e.stopPropagation()}
                role="document"
            >
                {isProcessing && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-30 animate-fade-in rounded-xl">
                        <Spinner />
                        <p className="text-lg font-semibold text-zinc-600 mt-4">Processing...</p>
                    </div>
                )}
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                    <h2 className="text-xl font-extrabold text-zinc-800">Brush Select Object</h2>
                    <button 
                        onClick={onClose}
                        className="text-zinc-500 hover:text-zinc-800 transition-colors z-10"
                        aria-label="Close modal"
                        disabled={isProcessing}
                    >
                        <CloseIcon />
                    </button>
                </div>
                
                <div ref={containerRef} className="flex-grow bg-zinc-100 rounded-lg relative flex items-center justify-center overflow-hidden">
                    {imageUrl && (
                        <>
                            <img ref={imageRef} src={imageUrl} alt="Product to edit" onLoad={handleImageLoad} className="max-w-full max-h-full object-contain" />
                            <canvas 
                                ref={canvasRef}
                                className="absolute top-0 left-0 cursor-crosshair"
                                onMouseDown={handleDrawingStart}
                                onMouseMove={handleDrawingMove}
                                onMouseUp={handleDrawingEnd}
                                onMouseLeave={handleDrawingEnd}
                                onTouchStart={handleDrawingStart}
                                onTouchMove={handleDrawingMove}
                                onTouchEnd={handleDrawingEnd}
                            />
                        </>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-center mt-4 flex-shrink-0 gap-4">
                    <div className="w-full sm:w-1/2 flex items-center gap-4">
                        <label htmlFor="brushSize" className="text-sm font-medium text-zinc-600 whitespace-nowrap">Brush Size</label>
                        <input
                            type="range"
                            id="brushSize"
                            min="10"
                            max="100"
                            step="5"
                            value={brushSize}
                            onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
                            disabled={isProcessing}
                            className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                         <span className="text-sm font-medium text-zinc-600 w-8 text-center">{brushSize}</span>
                    </div>
                     <div className="flex items-center gap-4">
                        <button
                            onClick={onClose}
                            disabled={isProcessing}
                            className="text-sm text-zinc-600 hover:text-zinc-800 font-semibold disabled:text-zinc-400 disabled:cursor-not-allowed transition-colors px-4 py-2"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={isProcessing}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg text-sm transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed"
                        >
                            Confirm Selection
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BackgroundRemovalModal;