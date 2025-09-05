/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useCallback, useRef, useState, useImperativeHandle, forwardRef, useEffect } from 'react';
import Spinner from './Spinner';
import { Edits, ImageUploaderRef } from './types';

interface PlacedProduct {
  source: 'product1' | 'product2';
  imageUrl: string;
  xPercent: number;
  yPercent: number;
  scale: number;
}

interface ImageUploaderProps {
  id: string;
  label?: string;
  onFileSelect: (file: File) => void;
  imageUrl: string | null;
  imageFile?: File | null;
  edits?: Edits;
  isDropZone?: boolean;
  onProductDrop?: (position: {x: number, y: number}, relativePosition: { xPercent: number; yPercent: number; }) => void;
  showDebugButton?: boolean;
  onDebugClick?: () => void;
  isTouchHovering?: boolean;
  touchOrbPosition?: { x: number; y: number } | null;
  isApplyingEdits?: boolean;
  isMaskingMode?: boolean;
  brushSize?: number;
  placedProduct?: PlacedProduct | null;
  onUpdatePlacedProduct?: (update: Partial<Omit<PlacedProduct, 'source' | 'imageUrl'>>) => void;
}

const UploadIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-zinc-500 mx-auto mb-2" fill="none" viewBox="0 0 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
);

const WarningIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.21 3.03-1.742 3.03H4.42c-1.532 0-2.492-1.696-1.742-3.03l5.58-9.92zM10 13a1 1 0 110-2 1 1 0 010 2zm-1-4a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z" clipRule="evenodd" />
    </svg>
);

// Helper for image sharpening via convolution matrix on a canvas
const applySharpen = (ctx: CanvasRenderingContext2D, width: number, height: number, amount: number) => {
    if (amount <= 0) return;
    const strength = amount / 100;
    
    const pixels = ctx.getImageData(0, 0, width, height);
    const output = ctx.createImageData(width, height);

    const weights = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    const side = 3;
    const halfSide = 1;
    
    const src = pixels.data;
    const dst = output.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dstOff = (y * width + x) * 4;
            let r = 0, g = 0, b = 0;

            for (let cy = 0; cy < side; cy++) {
                for (let cx = 0; cx < side; cx++) {
                    const scy = Math.min(height - 1, Math.max(0, y + cy - halfSide));
                    const scx = Math.min(width - 1, Math.max(0, x + cx - halfSide));
                    const srcOff = (scy * width + scx) * 4;
                    const wt = weights[cy * side + cx];
                    r += src[srcOff] * wt;
                    g += src[srcOff + 1] * wt;
                    b += src[srcOff + 2] * wt;
                }
            }

            const originalR = src[dstOff];
            const originalG = src[dstOff + 1];
            const originalB = src[dstOff + 2];

            dst[dstOff] = originalR * (1 - strength) + r * strength;
            dst[dstOff + 1] = originalG * (1 - strength) + g * strength;
            dst[dstOff + 2] = originalB * (1 - strength) + b * strength;
            dst[dstOff + 3] = src[dstOff + 3]; // Alpha
        }
    }
    ctx.putImageData(output, 0, 0);
};

// Helper to calculate distance between two touch points
const getTouchDistance = (touches: React.TouchList | TouchList) => {
    const touch1 = touches[0];
    const touch2 = touches[1];
    return Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) +
        Math.pow(touch2.clientY - touch1.clientY, 2)
    );
};

const ImageUploader = forwardRef<ImageUploaderRef, ImageUploaderProps>(({ id, label, onFileSelect, imageUrl, imageFile = null, edits, isDropZone = false, onProductDrop, showDebugButton, onDebugClick, isTouchHovering = false, touchOrbPosition = null, isApplyingEdits = false, isMaskingMode = false, brushSize = 40, placedProduct, onUpdatePlacedProduct }, ref) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourcePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [orbPosition, setOrbPosition] = useState<{x: number, y: number} | null>(null);
  const [fileTypeError, setFileTypeError] = useState<string | null>(null);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isPreviewSourceReady, setIsPreviewSourceReady] = useState(false);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  
  // Placed product interaction state
  const dragStartRef = useRef<{ startX: number; startY: number; startXPercent: number; startYPercent: number } | null>(null);
  const pinchStartRef = useRef<{ initialDist: number; initialScale: number } | null>(null);


  useImperativeHandle(ref, () => ({
    getMaskAsFile: async (): Promise<File | null> => {
        const maskCanvas = maskCanvasRef.current;
        if (!maskCanvas) return null;

        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
        if (!maskCtx) return null;

        const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const data = imageData.data;
        let hasDrawing = false;
        for (let i = 3; i < data.length; i += 4) { // Check alpha channel
            if (data[i] > 0) {
                hasDrawing = true;
                break;
            }
        }
        if (!hasDrawing) return null;

        // Create a black and white mask
        const bwCanvas = document.createElement('canvas');
        bwCanvas.width = maskCanvas.width;
        bwCanvas.height = maskCanvas.height;
        const bwCtx = bwCanvas.getContext('2d');
        if (!bwCtx) return null;
        
        const newImageData = bwCtx.createImageData(maskCanvas.width, maskCanvas.height);
        const newData = newImageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha > 0) { // If pixel was painted (is not transparent)
                newData[i] = 255;   // R = White
                newData[i + 1] = 255; // G = White
                newData[i + 2] = 255; // B = White
                newData[i + 3] = 255; // Alpha = Opaque
            } else { // Unpainted, make it black
                newData[i] = 0;       // R = Black
                newData[i + 1] = 0;     // G = Black
                newData[i + 2] = 0;     // B = Black
                newData[i + 3] = 255;   // Alpha = Opaque
            }
        }
        bwCtx.putImageData(newImageData, 0, 0);

        return new Promise(resolve => {
            bwCanvas.toBlob(blob => {
                if (blob) {
                    resolve(new File([blob], 'mask.png', { type: 'image/png' }));
                } else {
                    resolve(null);
                }
            }, 'image/png');
        });
    },
    getDisplayCanvas: () => canvasRef.current,
  }));
  
  useEffect(() => {
    if (!imageUrl) {
      setFileTypeError(null);
      setIsImageLoading(false);
      setIsPreviewSourceReady(false);
    }
  }, [imageUrl]);
  
  // Effect 1: Create the down-scaled source preview when the imageFile changes
  useEffect(() => {
    if (!imageFile) {
      setIsPreviewSourceReady(false);
      return;
    }

    const PREVIEW_MAX_DIM = 800;
    setIsPreviewSourceReady(false);

    const img = new Image();
    const objectUrl = URL.createObjectURL(imageFile);
    img.src = objectUrl;

    img.onload = () => {
        const sourceCanvas = sourcePreviewCanvasRef.current;
        const displayCanvas = canvasRef.current;
        if (!sourceCanvas || !displayCanvas) return;

        const { naturalWidth, naturalHeight } = img;
        let previewWidth = naturalWidth;
        let previewHeight = naturalHeight;

        if (previewWidth > PREVIEW_MAX_DIM || previewHeight > PREVIEW_MAX_DIM) {
            if (naturalWidth > naturalHeight) {
                previewHeight = (PREVIEW_MAX_DIM / naturalWidth) * naturalHeight;
                previewWidth = PREVIEW_MAX_DIM;
            } else {
                previewWidth = (PREVIEW_MAX_DIM / naturalHeight) * naturalWidth;
                previewHeight = PREVIEW_MAX_DIM;
            }
        }
        
        sourceCanvas.width = previewWidth;
        sourceCanvas.height = previewHeight;
        displayCanvas.width = previewWidth;
        displayCanvas.height = previewHeight;

        const sourceCtx = sourceCanvas.getContext('2d');
        if (sourceCtx) {
            sourceCtx.drawImage(img, 0, 0, previewWidth, previewHeight);
            setIsPreviewSourceReady(true);
        }
        URL.revokeObjectURL(objectUrl);
    };
    
    img.onerror = () => URL.revokeObjectURL(objectUrl);
    
    return () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageFile]);
  
  // Effect 2: Update the display canvas when edits change or preview source is ready
  useEffect(() => {
      if (!isPreviewSourceReady || !edits) return;

      const animationFrameId = requestAnimationFrame(() => {
          const sourceCanvas = sourcePreviewCanvasRef.current;
          const displayCanvas = canvasRef.current;
          if (!sourceCanvas || !displayCanvas) return;

          const ctx = displayCanvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          
          ctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
          
          // Apply filter-based effects first
          ctx.filter = `brightness(${edits.brightness}%) contrast(${edits.contrast}%) saturate(${edits.saturation}%)`;
          ctx.drawImage(sourceCanvas, 0, 0);
          
          // Reset filter so sharpening isn't affected by it
          ctx.filter = 'none'; 
          
          // Apply sharpening on the pixel data of the filtered image
          applySharpen(ctx, displayCanvas.width, displayCanvas.height, edits.sharpen);
      });

      return () => cancelAnimationFrame(animationFrameId);

  }, [edits, isPreviewSourceReady]);

  // Effect 3: Manage mask canvas when masking mode changes
  useEffect(() => {
    const maskCanvas = maskCanvasRef.current;
    const displayCanvas = canvasRef.current;
    if (!maskCanvas) return;

    if (isMaskingMode && displayCanvas) {
        // Match mask canvas size to display canvas size
        maskCanvas.width = displayCanvas.width;
        maskCanvas.height = displayCanvas.height;
    } else {
        // Clear mask canvas when masking mode is toggled off
        const ctx = maskCanvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        }
    }
  }, [isMaskingMode, isPreviewSourceReady]);


  const processAndSelectFile = useCallback((file: File | null | undefined) => {
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setFileTypeError('For best results, please use PNG, JPG, or JPEG formats.');
      return;
    }
    setFileTypeError(null);
    setIsImageLoading(true);
    onFileSelect(file);
  }, [onFileSelect]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    processAndSelectFile(event.target.files?.[0]);
  };
  
  // A shared handler for both click and drop placements.
  const handlePlacement = useCallback((clientX: number, clientY: number, currentTarget: HTMLDivElement) => {
    const canvas = canvasRef.current;
    if (!canvas || !onProductDrop) return;
    
    const sourceCanvas = sourcePreviewCanvasRef.current;
    if (!sourceCanvas) return;
    const { width: imageWidth, height: imageHeight } = sourceCanvas;

    const containerRect = currentTarget.getBoundingClientRect();
    const { width: containerWidth, height: containerHeight } = containerRect;

    const imageAspectRatio = imageWidth / imageHeight;
    const containerAspectRatio = containerWidth / containerHeight;

    let renderedWidth, renderedHeight;
    if (imageAspectRatio > containerAspectRatio) {
      renderedWidth = containerWidth;
      renderedHeight = containerWidth / imageAspectRatio;
    } else {
      renderedHeight = containerHeight;
      renderedWidth = containerHeight * imageAspectRatio;
    }
    
    const offsetX = (containerWidth - renderedWidth) / 2;
    const offsetY = (containerHeight - renderedHeight) / 2;

    const pointX = clientX - containerRect.left;
    const pointY = clientY - containerRect.top;

    const imageX = pointX - offsetX;
    const imageY = pointY - offsetY;

    if (imageX < 0 || imageX > renderedWidth || imageY < 0 || imageY > renderedHeight) {
      console.warn("Action was outside the image boundaries.");
      return;
    }

    const xPercent = (imageX / renderedWidth) * 100;
    const yPercent = (imageY / renderedHeight) * 100;

    onProductDrop({ x: pointX, y: pointY }, { xPercent, yPercent });
  }, [onProductDrop]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isDropZone && onProductDrop) {
      handlePlacement(event.clientX, event.clientY, event.currentTarget);
    } else if (!isMaskingMode) { // Prevent file dialog when masking
      inputRef.current?.click();
    }
  };
  
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDraggingOver(true);
      if (isDropZone && onProductDrop) {
          const rect = event.currentTarget.getBoundingClientRect();
          setOrbPosition({
              x: event.clientX - rect.left,
              y: event.clientY - rect.top
          });
      }
  }, [isDropZone, onProductDrop]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDraggingOver(false);
      setOrbPosition(null);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDraggingOver(false);
      setOrbPosition(null);

      if (isDropZone && onProductDrop) {
          handlePlacement(event.clientX, event.clientY, event.currentTarget);
      } else {
          const file = event.dataTransfer.files?.[0];
          if (file && file.type.startsWith('image/')) {
              processAndSelectFile(file);
          }
      }
  }, [isDropZone, onProductDrop, processAndSelectFile, handlePlacement]);
  
  const getPointInCanvas = useCallback((clientX: number, clientY: number): { x: number, y: number } | null => {
    const canvas = maskCanvasRef.current;
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
    if (!isMaskingMode || isDrawing) return;
    setIsDrawing(true);
    const point = getPointInCanvas(
        'touches' in e ? e.touches[0].clientX : e.clientX,
        'touches' in e ? e.touches[0].clientY : e.clientY
    );
    lastPointRef.current = point;
  }, [isMaskingMode, isDrawing, getPointInCanvas]);
  
  const handleDrawingMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isMaskingMode || !isDrawing) return;
    e.preventDefault(); // Prevent scrolling on touch devices
    
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    const currentPoint = getPointInCanvas(
        'touches' in e ? e.touches[0].clientX : e.clientX,
        'touches' in e ? e.touches[0].clientY : e.clientY
    );

    if (ctx && lastPointRef.current && currentPoint) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)'; // Red with transparency
        ctx.lineWidth = brushSize ?? 40;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        ctx.lineTo(currentPoint.x, currentPoint.y);
        ctx.stroke();
        
        lastPointRef.current = currentPoint;
    }
  }, [isMaskingMode, isDrawing, getPointInCanvas, brushSize]);

  const handleDrawingEnd = useCallback(() => {
    if (!isMaskingMode || !isDrawing) return;
    setIsDrawing(false);
    lastPointRef.current = null;
  }, [isMaskingMode, isDrawing]);

  // --- Placed Product Interaction Handlers ---

  const handlePreviewDragStart = (e: React.MouseEvent) => {
      e.preventDefault();
      if (!placedProduct) return;
      dragStartRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startXPercent: placedProduct.xPercent,
          startYPercent: placedProduct.yPercent,
      };
      window.addEventListener('mousemove', handlePreviewDragMove);
      window.addEventListener('mouseup', handlePreviewDragEnd);
  };
  
  const handlePreviewDragMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !containerRef.current || !onUpdatePlacedProduct) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      const deltaX = e.clientX - dragStartRef.current.startX;
      const deltaY = e.clientY - dragStartRef.current.startY;
      
      const deltaXPercent = (deltaX / rect.width) * 100;
      const deltaYPercent = (deltaY / rect.height) * 100;

      onUpdatePlacedProduct({
          xPercent: dragStartRef.current.startXPercent + deltaXPercent,
          yPercent: dragStartRef.current.startYPercent + deltaYPercent,
      });
  };

  const handlePreviewDragEnd = () => {
      dragStartRef.current = null;
      window.removeEventListener('mousemove', handlePreviewDragMove);
      window.removeEventListener('mouseup', handlePreviewDragEnd);
  };
  
  const handlePreviewTouchStart = (e: React.TouchEvent) => {
    if (!placedProduct || !onUpdatePlacedProduct) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.touches.length === 1) { // Dragging
        const touch = e.touches[0];
        dragStartRef.current = {
            startX: touch.clientX,
            startY: touch.clientY,
            startXPercent: placedProduct.xPercent,
            startYPercent: placedProduct.yPercent,
        };
    } else if (e.touches.length === 2) { // Pinching
        pinchStartRef.current = {
            initialDist: getTouchDistance(e.touches),
            initialScale: placedProduct.scale,
        };
        dragStartRef.current = null; // Prevent dragging while pinching
    }
  };

  const handlePreviewTouchMove = (e: React.TouchEvent) => {
    if (!placedProduct || !onUpdatePlacedProduct) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.touches.length === 1 && dragStartRef.current) { // Dragging
        if (!containerRef.current) return;
        const touch = e.touches[0];
        const rect = containerRef.current.getBoundingClientRect();
        const deltaX = touch.clientX - dragStartRef.current.startX;
        const deltaY = touch.clientY - dragStartRef.current.startY;
        
        const deltaXPercent = (deltaX / rect.width) * 100;
        const deltaYPercent = (deltaY / rect.height) * 100;

        onUpdatePlacedProduct({
            xPercent: dragStartRef.current.startXPercent + deltaXPercent,
            yPercent: dragStartRef.current.startYPercent + deltaYPercent,
        });

    } else if (e.touches.length === 2 && pinchStartRef.current) { // Pinching
        const currentDist = getTouchDistance(e.touches);
        const scaleFactor = currentDist / pinchStartRef.current.initialDist;
        const newScale = pinchStartRef.current.initialScale * scaleFactor;
        
        // Clamp scale to reasonable values
        onUpdatePlacedProduct({ scale: Math.max(0.1, Math.min(newScale, 5.0)) });
    }
  };

  const handlePreviewTouchEnd = (e: React.TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStartRef.current = null;
      }
      if (e.touches.length < 1) {
        dragStartRef.current = null;
      }
  };

  // --- End of Interaction Handlers ---

  const showHoverState = (isDraggingOver || isTouchHovering) && isDropZone;
  const currentOrbPosition = orbPosition || touchOrbPosition;
  const isActionable = isDropZone || !imageUrl;
  const vignetteStrength = edits?.vignette ?? 0;

  const uploaderClasses = `w-full aspect-video bg-zinc-100 border-2 border-dashed rounded-lg flex items-center justify-center transition-all duration-300 relative overflow-hidden ${
      showHoverState ? 'border-blue-500 bg-blue-50 is-dragging-over'
    : isMaskingMode ? 'border-red-400 cursor-crosshair'
    : isDropZone ? 'border-zinc-400 cursor-crosshair'
    : 'border-zinc-300 hover:border-blue-500 cursor-pointer'
  } ${!isActionable && !isMaskingMode ? 'cursor-default' : ''}`;

  return (
    <div className="flex flex-col items-center w-full">
      {label && <h3 className="text-xl font-semibold mb-4 text-zinc-700">{label}</h3>}
      <div
        ref={containerRef}
        className={uploaderClasses}
        onClick={isActionable ? handleClick : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseDown={!placedProduct ? handleDrawingStart : undefined}
        onMouseMove={!placedProduct ? handleDrawingMove : undefined}
        onMouseUp={!placedProduct ? handleDrawingEnd : undefined}
        onMouseLeave={!placedProduct ? handleDrawingEnd : undefined}
        onTouchStart={!placedProduct ? handleDrawingStart : undefined}
        onTouchMove={!placedProduct ? handleDrawingMove : undefined}
        onTouchEnd={!placedProduct ? handleDrawingEnd : undefined}
        data-dropzone-id={id}
      >
        <input
          type="file"
          id={id}
          ref={inputRef}
          onChange={handleFileChange}
          accept="image/png, image/jpeg"
          className="hidden"
        />
        <canvas ref={sourcePreviewCanvasRef} style={{ display: 'none' }} />
        <canvas ref={maskCanvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10" />
        {imageUrl ? (
          <>
            <canvas 
              ref={canvasRef}
              className={`w-full h-full object-contain transition-opacity duration-300 ${isImageLoading ? 'opacity-0' : 'opacity-100'}`}
              onLoad={() => setIsImageLoading(false)}
              onError={() => setIsImageLoading(false)}
            />
            
            {/* Fallback for initial load before canvas is ready */}
            <img 
              src={imageUrl} 
              alt={label || 'Uploaded Scene'} 
              className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 pointer-events-none ${isPreviewSourceReady ? 'opacity-0' : 'opacity-100'}`}
              onLoad={() => {
                setIsImageLoading(false);
              }}
            />

            {isImageLoading && (
                <div className="absolute inset-0 bg-zinc-100/70 flex items-center justify-center z-30 animate-fade-in">
                    <Spinner />
                </div>
            )}
            {isApplyingEdits && <div className="absolute inset-0 bg-white opacity-0 animate-flash-overlay z-20"></div>}
            
            {vignetteStrength > 0 && (
                <div
                    className="absolute inset-0 pointer-events-none rounded-lg"
                    style={{
                        boxShadow: `inset 0 0 ${vignetteStrength * 2}px ${vignetteStrength * 0.75}px rgba(0,0,0,0.8)`
                    }}
                ></div>
            )}

            {placedProduct && (
                <div
                    className="absolute w-32 h-32 cursor-grab active:cursor-grabbing z-20"
                    style={{
                        left: `${placedProduct.xPercent}%`,
                        top: `${placedProduct.yPercent}%`,
                        transform: `translate(-50%, -50%) scale(${placedProduct.scale})`,
                        touchAction: 'none', // Important for preventing browser gestures
                    }}
                    onMouseDown={handlePreviewDragStart}
                    onTouchStart={handlePreviewTouchStart}
                    onTouchMove={handlePreviewTouchMove}
                    onTouchEnd={handlePreviewTouchEnd}
                >
                    <div className="relative w-full h-full">
                        <img 
                            src={placedProduct.imageUrl} 
                            alt="Placed product preview" 
                            className="w-full h-full object-contain pointer-events-none"
                        />
                         <div className="absolute -inset-2 border-2 border-blue-500 border-dashed rounded-lg animate-pulse"></div>
                    </div>
                </div>
            )}
            
            <div 
                className="drop-orb" 
                style={{ 
                    left: currentOrbPosition ? currentOrbPosition.x : -9999, 
                    top: currentOrbPosition ? currentOrbPosition.y : -9999 
                }}
            ></div>

            {showDebugButton && onDebugClick && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDebugClick();
                    }}
                    className="absolute bottom-2 right-2 bg-black bg-opacity-60 text-white text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-opacity-80 transition-all z-20 shadow-lg"
                    aria-label="Show debug view"
                >
                    Debug
                </button>
            )}
          </>
        ) : (
          <div className="text-center text-zinc-500 p-4">
            <UploadIcon />
            <p>Click to upload or drag & drop</p>
          </div>
        )}
      </div>
      {fileTypeError && (
        <div className="w-full mt-2 text-sm text-yellow-800 bg-yellow-100 border border-yellow-300 rounded-lg p-3 flex items-center animate-fade-in" role="alert">
            <WarningIcon />
            <span>{fileTypeError}</span>
        </div>
      )}
    </div>
  );
});

export default ImageUploader;