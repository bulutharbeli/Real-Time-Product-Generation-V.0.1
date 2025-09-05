/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { generateCompositeImage, removeBackground, inpaintImage, removeBackgroundWithMask } from './services/geminiService';
import { Product, Edits, ImageUploaderRef } from './components/types';
import Header from './components/Header';
import ImageUploader from './components/ImageUploader';
import ObjectCard from './components/ObjectCard';
import Spinner from './components/Spinner';
import DebugModal from './components/DebugModal';
import TouchGhost from './components/TouchGhost';
import ImageEditorControls from './components/ImageEditorControls';
import BackgroundRemovalModal from './components/BackgroundRemovalModal';
import PlacementControls from './components/PlacementControls';

// Pre-load a transparent image to use for hiding the default drag ghost.
// This prevents a race condition on the first drag.
const transparentDragImage = new Image();
transparentDragImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Helper to convert a data URL string to a File object
const dataURLtoFile = (dataurl: string, filename: string): File => {
    const arr = dataurl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");

    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, {type:mime});
}

const loadingMessages = [
    "Analyzing your product...",
    "Surveying the scene...",
    "Describing placement location with AI...",
    "Crafting the perfect composition prompt...",
    "Generating photorealistic options...",
    "Assembling the final scene..."
];

type HistoryEntry = {
  file: File;
  url: string;
  debugImageUrl: string | null;
  debugPrompt: string | null;
};

interface PlacedProduct {
  source: 'product1' | 'product2';
  imageUrl: string;
  xPercent: number;
  yPercent: number;
  scale: number;
}

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
                    // FIX: Corrected typo from Mth.min to Math.min
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

// Helper function to apply brightness/contrast/saturation to an image file via canvas
const applyEditsToImageFile = async (file: File, edits: Edits): Promise<File> => {
    const objectUrl = URL.createObjectURL(file);
    try {
        const editedFile = await new Promise<File>((resolve, reject) => {
            const img = new Image();
            img.src = objectUrl;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const w = img.naturalWidth;
                const h = img.naturalHeight;
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) {
                    return reject(new Error('Could not get canvas context.'));
                }

                // Draw the original image first
                ctx.drawImage(img, 0, 0);

                // 1. Apply sharpening first on the raw pixel data
                applySharpen(ctx, w, h, edits.sharpen);

                // 2. Apply filter-based effects
                ctx.filter = `brightness(${edits.brightness}%) contrast(${edits.contrast}%) saturate(${edits.saturation}%)`;
                // Re-draw the (potentially sharpened) canvas onto itself to apply the filters
                ctx.drawImage(canvas, 0, 0);

                // 3. Apply vignette as the final layer
                if (edits.vignette > 0) {
                    const strength = edits.vignette / 100;
                    const outerRadius = Math.sqrt(w*w + h*h) / 2;
                    const gradient = ctx.createRadialGradient(w/2, h/2, h/4, w/2, h/2, outerRadius);
                    gradient.addColorStop(0, 'rgba(0,0,0,0)');
                    gradient.addColorStop(0.5, `rgba(0,0,0,${strength * 0.2})`);
                    gradient.addColorStop(1, `rgba(0,0,0,${strength * 0.7})`);
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, w, h);
                }

                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(new File([blob], `edited-${file.name}`, { type: blob.type || 'image/jpeg' }));
                    } else {
                        reject(new Error('Canvas to Blob conversion failed.'));
                    }
                }, file.type || 'image/jpeg', 0.95);
            };
            img.onerror = (err) => reject(new Error(`Image load error during edit apply: ${err}`));
        });
        return editedFile;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
};

const App: React.FC = () => {
  const [product1, setProduct1] = useState<Product | null>(null);
  const [product1File, setProduct1File] = useState<File | null>(null);
  const [product2, setProduct2] = useState<Product | null>(null);
  const [product2File, setProduct2File] = useState<File | null>(null);
  const [selectedProductSource, setSelectedProductSource] = useState<'product1' | 'product2' | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  const [isRemovingBackground, setIsRemovingBackground] = useState<'product1' | 'product2' | null>(null);

  // State for scene history (undo/redo)
  const [sceneHistory, setSceneHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  
  // State for image editing preview
  const [imageEdits, setImageEdits] = useState<Edits>({
      brightness: 100,
      contrast: 100,
      saturation: 100,
      sharpen: 0,
      vignette: 0,
  });
  const [isApplyingEdits, setIsApplyingEdits] = useState(false);
  
  // State for masking/inpainting
  const [isMaskingMode, setIsMaskingMode] = useState(false);
  const [brushSize, setBrushSize] = useState(40);

  // State for manual background removal modal
  const [productForBgRemoval, setProductForBgRemoval] = useState<'product1' | 'product2' | null>(null);
  const [isProcessingManualBg, setIsProcessingManualBg] = useState(false);

  // State for touch drag & drop
  const [isTouchDragging, setIsTouchDragging] = useState<boolean>(false);
  const [draggingImageUrl, setDraggingImageUrl] = useState<string | null>(null);
  const [touchGhostPosition, setTouchGhostPosition] = useState<{x: number, y: number} | null>(null);
  const [isHoveringDropZone, setIsHoveringDropZone] = useState<boolean>(false);
  const [touchOrbPosition, setTouchOrbPosition] = useState<{x: number, y: number} | null>(null);
  const sceneUploaderRef = useRef<ImageUploaderRef>(null);
  
  // State for placed product preview
  const [placedProduct, setPlacedProduct] = useState<PlacedProduct | null>(null);

  // --- Derived State ---
  const currentHistoryEntry = sceneHistory[historyIndex] ?? null;
  const sceneImage = currentHistoryEntry?.file ?? null;
  const sceneImageUrl = currentHistoryEntry?.url ?? null;
  const debugImageUrl = currentHistoryEntry?.debugImageUrl ?? null;
  const debugPrompt = currentHistoryEntry?.debugPrompt ?? null;

  const selectedProduct = selectedProductSource === 'product1' ? product1 : selectedProductSource === 'product2' ? product2 : null;
  
  const handleProductImageUpload = useCallback((file: File, productSlot: 'product1' | 'product2') => {
    setError(null);
    try {
        const imageUrl = URL.createObjectURL(file);
        const product: Product = {
            id: Date.now(),
            name: file.name,
            imageUrl: imageUrl,
        };
        
        if (productSlot === 'product1') {
            if (product1?.imageUrl) URL.revokeObjectURL(product1.imageUrl);
            setProduct1(product);
            setProduct1File(file);
            setSelectedProductSource('product1');
        } else {
            if (product2?.imageUrl) URL.revokeObjectURL(product2.imageUrl);
            setProduct2(product);
            setProduct2File(file);
            setSelectedProductSource('product2');
        }

    } catch(err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Could not load the product image. Details: ${errorMessage}`);
      console.error(err);
    }
  }, [product1, product2]);

  const handleInitialProductUpload = useCallback((file: File) => {
    handleProductImageUpload(file, 'product1');
  }, [handleProductImageUpload]);
  
  const setInitialScene = useCallback((file: File) => {
    // Clean up any existing history before starting a new one
    sceneHistory.forEach(entry => URL.revokeObjectURL(entry.url));
    
    const url = URL.createObjectURL(file);
    const newEntry: HistoryEntry = { file, url, debugImageUrl: null, debugPrompt: null };
    
    setSceneHistory([newEntry]);
    setHistoryIndex(0);
    setPlacedProduct(null);
  }, [sceneHistory]);

  const handleInstantStart = useCallback(async () => {
    setError(null);
    try {
      // Fetch the default images
      const [objectResponse, sceneResponse] = await Promise.all([
        fetch('/assets/object.jpeg'),
        fetch('/assets/scene.jpeg')
      ]);

      if (!objectResponse.ok || !sceneResponse.ok) {
        throw new Error('Failed to load default images');
      }

      // Convert to blobs then to File objects
      const [objectBlob, sceneBlob] = await Promise.all([
        objectResponse.blob(),
        sceneResponse.blob()
      ]);

      const objectFile = new File([objectBlob], 'object.jpeg', { type: 'image/jpeg' });
      const sceneFile = new File([sceneBlob], 'scene.jpeg', { type: 'image/jpeg' });

      // Update state with the new files
      setInitialScene(sceneFile);
      handleProductImageUpload(objectFile, 'product1');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Could not load default images. Details: ${errorMessage}`);
      console.error(err);
    }
  }, [handleProductImageUpload, setInitialScene]);

  const handleProductDrop = useCallback((_position: {x: number, y: number}, relativePosition: { xPercent: number; yPercent: number; }) => {
    if (!selectedProductSource || !selectedProduct) return;
    
    setPlacedProduct({
        source: selectedProductSource,
        imageUrl: selectedProduct.imageUrl,
        xPercent: relativePosition.xPercent,
        yPercent: relativePosition.yPercent,
        scale: 1.0,
    });
    setError(null);
    setIsLoading(false);
  }, [selectedProduct, selectedProductSource]);

  const handleUpdatePlacedProduct = useCallback((update: Partial<Omit<PlacedProduct, 'source' | 'imageUrl'>>) => {
    setPlacedProduct(prev => prev ? { ...prev, ...update } : null);
  }, []);

  const handleCancelPlacement = useCallback(() => {
    setPlacedProduct(null);
  }, []);

  const handleConfirmPlacement = useCallback(async () => {
    if (!placedProduct || !sceneImage) {
        setError('An unexpected error occurred. Missing product or scene data.');
        return;
    }
    
    const productFileToUse = placedProduct.source === 'product1' ? product1File : product2File;
    const productToUse = placedProduct.source === 'product1' ? product1 : product2;

    if (!productFileToUse || !productToUse) {
      setError('An unexpected error occurred. Please try again.');
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      const { finalImageUrl, debugImageUrl: newDebugImage, finalPrompt } = await generateCompositeImage(
        productFileToUse, 
        productToUse.name,
        sceneImage,
        sceneImage.name,
        { xPercent: placedProduct.xPercent, yPercent: placedProduct.yPercent },
        placedProduct.scale
      );

      const newSceneFile = dataURLtoFile(finalImageUrl, `generated-scene-${Date.now()}.jpeg`);
      const newUrl = URL.createObjectURL(newSceneFile);

      const newEntry: HistoryEntry = {
          file: newSceneFile,
          url: newUrl,
          debugImageUrl: newDebugImage,
          debugPrompt: finalPrompt
      };

      const newHistory = sceneHistory.slice(0, historyIndex + 1);
      const prunedHistory = sceneHistory.slice(historyIndex + 1);
      prunedHistory.forEach(entry => URL.revokeObjectURL(entry.url));

      newHistory.push(newEntry);
      setSceneHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to generate the image. ${errorMessage}`);
      console.error(err);
    } finally {
      setIsLoading(false);
      setPlacedProduct(null);
    }
  }, [placedProduct, sceneImage, product1File, product2File, product1, product2, sceneHistory, historyIndex]);

  const handleRemoveBackground = useCallback(async (productSlot: 'product1' | 'product2') => {
      const fileToProcess = productSlot === 'product1' ? product1File : product2File;
      const productToUpdate = productSlot === 'product1' ? product1 : product2;

      if (!fileToProcess || !productToUpdate) {
          setError('Product image not found.');
          return;
      }
      
      setError(null);
      setIsRemovingBackground(productSlot);

      try {
          const newImageDataUrl = await removeBackground(fileToProcess);
          const newFile = dataURLtoFile(newImageDataUrl, `bg-removed-${fileToProcess.name}.png`);
          
          // Clean up old URL
          URL.revokeObjectURL(productToUpdate.imageUrl);
          
          const newImageUrl = URL.createObjectURL(newFile);
          const updatedProduct: Product = { ...productToUpdate, imageUrl: newImageUrl };

          if (productSlot === 'product1') {
              setProduct1File(newFile);
              setProduct1(updatedProduct);
          } else {
              setProduct2File(newFile);
              setProduct2(updatedProduct);
          }

      } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
          setError(`Failed to remove background. ${errorMessage}`);
          console.error(err);
      } finally {
          setIsRemovingBackground(null);
      }
  }, [product1File, product2File, product1, product2]);
  
  const handleOpenManualRemoveBg = (productSlot: 'product1' | 'product2') => {
    setProductForBgRemoval(productSlot);
  };

  const handleConfirmManualRemoveBg = async (maskFile: File) => {
    const fileToProcess = productForBgRemoval === 'product1' ? product1File : product2File;
    const productToUpdate = productForBgRemoval === 'product1' ? product1 : product2;

    if (!fileToProcess || !productToUpdate) {
        setError('Product image not found for background removal.');
        setProductForBgRemoval(null);
        return;
    }

    setError(null);
    setIsProcessingManualBg(true);

    try {
        const newImageDataUrl = await removeBackgroundWithMask(fileToProcess, maskFile);
        const newFile = dataURLtoFile(newImageDataUrl, `bg-removed-${fileToProcess.name}.png`);
        
        URL.revokeObjectURL(productToUpdate.imageUrl);
        
        const newImageUrl = URL.createObjectURL(newFile);
        const updatedProduct: Product = { ...productToUpdate, imageUrl: newImageUrl };

        if (productForBgRemoval === 'product1') {
            setProduct1File(newFile);
            setProduct1(updatedProduct);
        } else {
            setProduct2File(newFile);
            setProduct2(updatedProduct);
        }

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to remove background with brush. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsProcessingManualBg(false);
        setProductForBgRemoval(null);
    }
  };


  const handleReset = useCallback(() => {
    if (product1?.imageUrl) URL.revokeObjectURL(product1.imageUrl);
    if (product2?.imageUrl) URL.revokeObjectURL(product2.imageUrl);
    setProduct1(null);
    setProduct1File(null);
    setProduct2(null);
    setProduct2File(null);
    setSelectedProductSource(null);
    
    sceneHistory.forEach(entry => URL.revokeObjectURL(entry.url));
    setSceneHistory([]);
    setHistoryIndex(-1);

    setError(null);
    setIsLoading(false);
    setPlacedProduct(null);
    setIsMaskingMode(false);
  }, [sceneHistory, product1, product2]);

  const handleChangeProduct1 = useCallback(() => {
    if (product1?.imageUrl) URL.revokeObjectURL(product1.imageUrl);
    setProduct1(null);
    setProduct1File(null);
    if (selectedProductSource === 'product1') {
        setSelectedProductSource(product2 ? 'product2' : null);
    }
    setPlacedProduct(null);
  }, [product1, product2, selectedProductSource]);

  const handleChangeProduct2 = useCallback(() => {
    if (product2?.imageUrl) URL.revokeObjectURL(product2.imageUrl);
    setProduct2(null);
    setProduct2File(null);
    if (selectedProductSource === 'product2') {
        setSelectedProductSource(product1 ? 'product1' : null);
    }
    setPlacedProduct(null);
  }, [product1, product2, selectedProductSource]);
  
  const handleChangeScene = useCallback(() => {
    sceneHistory.forEach(entry => URL.revokeObjectURL(entry.url));
    setSceneHistory([]);
    setHistoryIndex(-1);
    setPlacedProduct(null);
    setIsMaskingMode(false);
  }, [sceneHistory]);
  
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prevIndex => prevIndex - 1);
      setPlacedProduct(null);
    }
  }, [historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < sceneHistory.length - 1) {
      setHistoryIndex(prevIndex => prevIndex + 1);
      setPlacedProduct(null);
    }
  }, [historyIndex, sceneHistory.length]);

  const handleResetEdits = useCallback(() => {
      setImageEdits({ brightness: 100, contrast: 100, saturation: 100, sharpen: 0, vignette: 0 });
  }, []);

  const handleApplyEdits = useCallback(async () => {
    if (!sceneImage) return;

    setIsLoading(true);
    setError(null);
    try {
        const editedFile = await applyEditsToImageFile(sceneImage, imageEdits);
        const newUrl = URL.createObjectURL(editedFile);

        const newEntry: HistoryEntry = {
            file: editedFile,
            url: newUrl,
            debugImageUrl: null,
            debugPrompt: null,
        };

        const newHistory = sceneHistory.slice(0, historyIndex + 1);
        const prunedHistory = sceneHistory.slice(historyIndex + 1);
        prunedHistory.forEach(entry => URL.revokeObjectURL(entry.url));

        newHistory.push(newEntry);
        setSceneHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        
        setIsApplyingEdits(true);
        setTimeout(() => setIsApplyingEdits(false), 500); // Duration of the flash animation

        handleResetEdits();

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to apply edits to the image. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
    }
  }, [sceneImage, imageEdits, sceneHistory, historyIndex, handleResetEdits]);

  const handleToggleMaskingMode = useCallback((active: boolean) => {
    setIsMaskingMode(active);
    if (active) setPlacedProduct(null);
  }, []);
  
  const handleApplyInpainting = useCallback(async () => {
    if (!sceneImage || !sceneUploaderRef.current) return;

    const maskFile = await sceneUploaderRef.current.getMaskAsFile();
    if (!maskFile) {
        setError("Please paint a mask over the object you want to remove before confirming.");
        return;
    }

    setIsLoading(true);
    setError(null);
    setIsMaskingMode(false); // Exit masking mode immediately

    try {
        const inpaintedImageDataUrl = await inpaintImage(sceneImage, maskFile);
        const newSceneFile = dataURLtoFile(inpaintedImageDataUrl, `inpainted-scene-${Date.now()}.jpeg`);
        const newUrl = URL.createObjectURL(newSceneFile);

        const newEntry: HistoryEntry = {
            file: newSceneFile,
            url: newUrl,
            debugImageUrl: null,
            debugPrompt: null
        };

        const newHistory = sceneHistory.slice(0, historyIndex + 1);
        const prunedHistory = sceneHistory.slice(historyIndex + 1);
        prunedHistory.forEach(entry => URL.revokeObjectURL(entry.url));
        
        newHistory.push(newEntry);
        setSceneHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to remove object from the scene. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
    }
  }, [sceneImage, sceneHistory, historyIndex]);

  useEffect(() => {
    // This consolidated effect handles cleanup for all blob URLs.
    return () => {
        sceneHistory.forEach(entry => URL.revokeObjectURL(entry.url));
        if (product1?.imageUrl) URL.revokeObjectURL(product1.imageUrl);
        if (product2?.imageUrl) URL.revokeObjectURL(product2.imageUrl);
    };
  }, [sceneHistory, product1, product2]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isLoading) {
        setLoadingMessageIndex(0); // Reset on start
        interval = setInterval(() => {
            setLoadingMessageIndex(prevIndex => (prevIndex + 1) % loadingMessages.length);
        }, 3000);
    }
    return () => {
        if (interval) clearInterval(interval);
    };
  }, [isLoading]);

  useEffect(() => {
    handleResetEdits();
    setIsMaskingMode(false); // Exit masking mode if the scene changes
    setPlacedProduct(null); // Remove placed product if the scene changes
  }, [historyIndex, handleResetEdits]);

  const handleTouchStart = (e: React.TouchEvent, source: 'product1' | 'product2') => {
    const product = source === 'product1' ? product1 : product2;
    if (!product || placedProduct) return;

    setSelectedProductSource(source);
    setDraggingImageUrl(product.imageUrl);

    // Prevent page scroll
    e.preventDefault();
    setIsTouchDragging(true);
    const touch = e.touches[0];
    setTouchGhostPosition({ x: touch.clientX, y: touch.clientY });
  };

  useEffect(() => {
    const handleTouchMove = (e: TouchEvent) => {
      if (!isTouchDragging) return;
      const touch = e.touches[0];
      setTouchGhostPosition({ x: touch.clientX, y: touch.clientY });
      
      const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
      const dropZone = elementUnderTouch?.closest<HTMLDivElement>('[data-dropzone-id="scene-uploader"]');

      if (dropZone) {
          const rect = dropZone.getBoundingClientRect();
          setTouchOrbPosition({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
          setIsHoveringDropZone(true);
      } else {
          setIsHoveringDropZone(false);
          setTouchOrbPosition(null);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!isTouchDragging) return;
      
      const touch = e.changedTouches[0];
      const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
      const dropZone = elementUnderTouch?.closest<HTMLDivElement>('[data-dropzone-id="scene-uploader"]');
      const canvas = sceneUploaderRef.current?.getDisplayCanvas();

      if (dropZone && canvas) {
          const containerRect = dropZone.getBoundingClientRect();
          const { width: naturalWidth, height: naturalHeight } = canvas;
          const { width: containerWidth, height: containerHeight } = containerRect;

          const imageAspectRatio = naturalWidth / naturalHeight;
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

          const dropX = touch.clientX - containerRect.left;
          const dropY = touch.clientY - containerRect.top;

          const imageX = dropX - offsetX;
          const imageY = dropY - offsetY;
          
          if (!(imageX < 0 || imageX > renderedWidth || imageY < 0 || imageY > renderedHeight)) {
            const xPercent = (imageX / renderedWidth) * 100;
            const yPercent = (imageY / renderedHeight) * 100;
            
            handleProductDrop({ x: dropX, y: dropY }, { xPercent, yPercent });
          }
      }

      setIsTouchDragging(false);
      setTouchGhostPosition(null);
      setIsHoveringDropZone(false);
      setTouchOrbPosition(null);
      setDraggingImageUrl(null);
    };

    if (isTouchDragging) {
      document.body.style.overflow = 'hidden'; // Prevent scrolling
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd, { passive: false });
    }

    return () => {
      document.body.style.overflow = 'auto';
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isTouchDragging, handleProductDrop]);

  const renderContent = () => {
    if (error) {
       return (
           <div className="text-center animate-fade-in bg-red-50 border border-red-200 p-8 rounded-lg max-w-2xl mx-auto">
            <h2 className="text-3xl font-extrabold mb-4 text-red-800">An Error Occurred</h2>
            <p className="text-lg text-red-700 mb-6">{error}</p>
            <button
                onClick={handleReset}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-lg text-lg transition-colors"
              >
                Try Again
            </button>
          </div>
        );
    }
    
    if (!product1File || !sceneImage) {
      return (
        <div className="w-full max-w-6xl mx-auto animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
            <div className="flex flex-col">
              <h2 className="text-2xl font-extrabold text-center mb-5 text-zinc-800">Upload Product</h2>
              <ImageUploader 
                id="product-uploader"
                onFileSelect={handleInitialProductUpload}
                imageUrl={product1?.imageUrl ?? null}
              />
            </div>
            <div className="flex flex-col">
              <h2 className="text-2xl font-extrabold text-center mb-5 text-zinc-800">Upload Scene</h2>
              <ImageUploader 
                id="scene-uploader"
                onFileSelect={setInitialScene}
                imageUrl={sceneImageUrl}
              />
            </div>
          </div>
          <div className="text-center mt-10 min-h-[4rem] flex flex-col justify-center items-center">
            <p className="text-zinc-500 animate-fade-in">
              Upload a product image and a scene image to begin.
            </p>
            <p className="text-zinc-500 animate-fade-in mt-2">
              Or click{' '}
              <button
                onClick={handleInstantStart}
                className="font-bold text-blue-600 hover:text-blue-800 underline transition-colors"
              >
                here
              </button>
              {' '}for an instant start.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full max-w-7xl mx-auto animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-stretch">
          {/* Product 1 Column */}
          <div className="md:col-span-1 flex flex-col">
            <h2 className="text-2xl font-extrabold text-center mb-5 text-zinc-800">Product 1</h2>
            <div className="flex-grow flex items-center justify-center">
              <div 
                  draggable={!placedProduct}
                  onDragStart={(e) => {
                      if (placedProduct) { e.preventDefault(); return; }
                      setSelectedProductSource('product1');
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setDragImage(transparentDragImage, 0, 0);
                  }}
                  onTouchStart={(e) => handleTouchStart(e, 'product1')}
                  onClick={() => setSelectedProductSource('product1')}
                  className={`w-full max-w-xs ${!placedProduct ? 'cursor-move' : 'cursor-not-allowed'}`}
              >
                  <ObjectCard 
                    product={product1!} 
                    isSelected={selectedProductSource === 'product1'} 
                    onRemoveBackground={() => handleRemoveBackground('product1')}
                    onManualRemoveBackground={() => handleOpenManualRemoveBg('product1')}
                    isRemovingBackground={isRemovingBackground === 'product1' || (isProcessingManualBg && productForBgRemoval === 'product1')}
                    disabled={isLoading || !!isRemovingBackground || isProcessingManualBg || !!placedProduct}
                  />
              </div>
            </div>
            <div className="text-center mt-4">
               <div className="h-5 flex items-center justify-center">
                <button
                    onClick={handleChangeProduct1}
                    className="text-sm text-blue-600 hover:text-blue-800 font-semibold"
                >
                    Change Product
                </button>
               </div>
            </div>
          </div>
          {/* Product 2 Column */}
          <div className="md:col-span-1 flex flex-col">
            <h2 className="text-2xl font-extrabold text-center mb-5 text-zinc-800">Product 2</h2>
            <div className="flex-grow flex items-center justify-center">
              {product2File ? (
                <div 
                    draggable={!placedProduct}
                    onDragStart={(e) => {
                        if (placedProduct) { e.preventDefault(); return; }
                        setSelectedProductSource('product2');
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setDragImage(transparentDragImage, 0, 0);
                    }}
                    onTouchStart={(e) => handleTouchStart(e, 'product2')}
                    onClick={() => setSelectedProductSource('product2')}
                    className={`w-full max-w-xs ${!placedProduct ? 'cursor-move' : 'cursor-not-allowed'}`}
                >
                    <ObjectCard 
                      product={product2!} 
                      isSelected={selectedProductSource === 'product2'}
                      onRemoveBackground={() => handleRemoveBackground('product2')}
                      onManualRemoveBackground={() => handleOpenManualRemoveBg('product2')}
                      isRemovingBackground={isRemovingBackground === 'product2' || (isProcessingManualBg && productForBgRemoval === 'product2')}
                      disabled={isLoading || !!isRemovingBackground || isProcessingManualBg || !!placedProduct}
                    />
                </div>
              ) : (
                <ImageUploader
                  id="product2-uploader"
                  onFileSelect={(file) => handleProductImageUpload(file, 'product2')}
                  imageUrl={null}
                />
              )}
            </div>
            {product2File && (
              <div className="text-center mt-4">
                <div className="h-5 flex items-center justify-center">
                  <button
                      onClick={handleChangeProduct2}
                      className="text-sm text-blue-600 hover:text-blue-800 font-semibold"
                  >
                      Change Product
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* Scene Column */}
          <div className="md:col-span-2 flex flex-col">
            <h2 className="text-2xl font-extrabold text-center mb-5 text-zinc-800">Scene</h2>
            <div className="flex-grow flex items-center justify-center">
              <ImageUploader 
                  ref={sceneUploaderRef}
                  id="scene-uploader" 
                  onFileSelect={setInitialScene} 
                  imageUrl={sceneImageUrl}
                  imageFile={sceneImage}
                  edits={imageEdits}
                  isDropZone={!!sceneImage && !isLoading && !isMaskingMode && !placedProduct}
                  onProductDrop={handleProductDrop}
                  showDebugButton={!!debugImageUrl && !isLoading}
                  onDebugClick={() => setIsDebugModalOpen(true)}
                  isTouchHovering={isHoveringDropZone}
                  touchOrbPosition={touchOrbPosition}
                  isApplyingEdits={isApplyingEdits}
                  isMaskingMode={isMaskingMode}
                  brushSize={brushSize}
                  placedProduct={placedProduct}
                  onUpdatePlacedProduct={handleUpdatePlacedProduct}
              />
            </div>
             {sceneImage && (
                <ImageEditorControls
                    edits={imageEdits}
                    onEditChange={setImageEdits}
                    onApply={handleApplyEdits}
                    onReset={handleResetEdits}
                    disabled={isLoading || !!placedProduct}
                    isMaskingMode={isMaskingMode}
                    onToggleMaskingMode={handleToggleMaskingMode}
                    onApplyMask={handleApplyInpainting}
                    brushSize={brushSize}
                    onBrushSizeChange={setBrushSize}
                />
             )}
             <div className="text-center mt-4">
              <div className="h-5 flex items-center justify-center gap-6">
                {sceneImage && !isLoading && !placedProduct && (
                  <>
                    <button
                        onClick={handleUndo}
                        disabled={historyIndex <= 0}
                        className="text-sm text-blue-600 hover:text-blue-800 font-semibold disabled:text-zinc-400 disabled:cursor-not-allowed transition-colors"
                        aria-label="Undo last action"
                    >
                        Undo
                    </button>
                    <button
                        onClick={handleChangeScene}
                        className="text-sm text-blue-600 hover:text-blue-800 font-semibold"
                    >
                        Change Scene
                    </button>
                    <button
                        onClick={handleRedo}
                        disabled={historyIndex >= sceneHistory.length - 1}
                        className="text-sm text-blue-600 hover:text-blue-800 font-semibold disabled:text-zinc-400 disabled:cursor-not-allowed transition-colors"
                        aria-label="Redo last action"
                    >
                        Redo
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="text-center mt-10 min-h-[8rem] flex flex-col justify-center items-center">
           {isLoading ? (
             <div className="animate-fade-in">
                <Spinner />
                <p className="text-xl mt-4 text-zinc-600 transition-opacity duration-500">{loadingMessages[loadingMessageIndex]}</p>
             </div>
           ) : placedProduct ? (
             <PlacementControls 
                scale={placedProduct.scale}
                onScaleChange={(newScale) => handleUpdatePlacedProduct({ scale: newScale })}
                onConfirm={handleConfirmPlacement}
                onCancel={handleCancelPlacement}
                disabled={isLoading}
             />
           ) : (
             <p className="text-zinc-500 animate-fade-in">
                {isMaskingMode 
                    ? 'Paint over an object to remove it from the scene.'
                    : 'Drag a product onto a location in the scene, or simply click where you want it.'
                }
             </p>
           )}
        </div>
      </div>
    );
  };
  
  return (
    <div className="min-h-screen bg-white text-zinc-800 flex items-center justify-center p-4 md:p-8">
      <TouchGhost 
        imageUrl={isTouchDragging ? draggingImageUrl : null} 
        position={touchGhostPosition}
      />
      <div className="flex flex-col items-center gap-8 w-full">
        <Header />
        <main className="w-full">
          {renderContent()}
        </main>
      </div>
      <DebugModal 
        isOpen={isDebugModalOpen} 
        onClose={() => setIsDebugModalOpen(false)}
        imageUrl={debugImageUrl}
        prompt={debugPrompt}
      />
      <BackgroundRemovalModal
        isOpen={!!productForBgRemoval}
        onClose={() => setProductForBgRemoval(null)}
        imageFile={productForBgRemoval === 'product1' ? product1File : product2File}
        onConfirm={handleConfirmManualRemoveBg}
        isProcessing={isProcessingManualBg}
      />
    </div>
  );
};

export default App;