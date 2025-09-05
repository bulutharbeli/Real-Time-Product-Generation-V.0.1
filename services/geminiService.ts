/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

// Helper to get intrinsic image dimensions from a File object
const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            if (!event.target?.result) {
                return reject(new Error("Failed to read file."));
            }
            const img = new Image();
            img.src = event.target.result as string;
            img.onload = () => {
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
            };
            img.onerror = (err) => reject(new Error(`Image load error: ${err}`));
        };
        reader.onerror = (err) => reject(new Error(`File reader error: ${err}`));
    });
};

// Helper to crop a square image back to an original aspect ratio, removing padding.
const cropToOriginalAspectRatio = (
    imageDataUrl: string,
    originalWidth: number,
    originalHeight: number,
    targetDimension: number
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = imageDataUrl;
        img.onload = () => {
            // Re-calculate the dimensions of the content area within the padded square image
            const aspectRatio = originalWidth / originalHeight;
            let contentWidth, contentHeight;
            if (aspectRatio > 1) { // Landscape
                contentWidth = targetDimension;
                contentHeight = targetDimension / aspectRatio;
            } else { // Portrait or square
                contentHeight = targetDimension;
                contentWidth = targetDimension * aspectRatio;
            }

            // Calculate the top-left offset of the content area
            const x = (targetDimension - contentWidth) / 2;
            const y = (targetDimension - contentHeight) / 2;

            const canvas = document.createElement('canvas');
            // Set canvas to the final, un-padded dimensions
            canvas.width = contentWidth;
            canvas.height = contentHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Could not get canvas context for cropping.'));
            }
            
            // Draw the relevant part of the square generated image onto the new, smaller canvas
            ctx.drawImage(img, x, y, contentWidth, contentHeight, 0, 0, contentWidth, contentHeight);
            
            // Return the data URL of the newly cropped image
            resolve(canvas.toDataURL('image/jpeg', 0.95));
        };
        img.onerror = (err) => reject(new Error(`Image load error during cropping: ${err}`));
    });
};


// New resize logic inspired by the reference to enforce a consistent aspect ratio without cropping.
// It resizes the image to fit within a square and adds padding, ensuring a consistent
// input size for the AI model, which enhances stability.
const resizeImage = (file: File, targetDimension: number): Promise<File> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            if (!event.target?.result) {
                return reject(new Error("Failed to read file."));
            }
            const img = new Image();
            img.src = event.target.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = targetDimension;
                canvas.height = targetDimension;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return reject(new Error('Could not get canvas context.'));
                }

                // Fill the canvas with a neutral background to avoid transparency issues
                // and ensure a consistent input format for the model.
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, targetDimension, targetDimension);

                // Calculate new dimensions to fit inside the square canvas while maintaining aspect ratio
                const aspectRatio = img.width / img.height;
                let newWidth, newHeight;

                if (aspectRatio > 1) { // Landscape image
                    newWidth = targetDimension;
                    newHeight = targetDimension / aspectRatio;
                } else { // Portrait or square image
                    newHeight = targetDimension;
                    newWidth = targetDimension * aspectRatio;
                }

                // Calculate position to center the image on the canvas
                const x = (targetDimension - newWidth) / 2;
                const y = (targetDimension - newHeight) / 2;
                
                // Draw the resized image onto the centered position
                ctx.drawImage(img, x, y, newWidth, newHeight);

                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(new File([blob], file.name, {
                            type: 'image/jpeg', // Force jpeg to handle padding color consistently
                            lastModified: Date.now()
                        }));
                    } else {
                        reject(new Error('Canvas to Blob conversion failed.'));
                    }
                }, 'image/jpeg', 0.95);
            };
            img.onerror = (err) => reject(new Error(`Image load error: ${err}`));
        };
        reader.onerror = (err) => reject(new Error(`File reader error: ${err}`));
    });
};

// New helper to resize an image to specific dimensions, potentially changing aspect ratio.
const resizeImageToDimensions = (file: File, width: number, height: number): Promise<File> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            if (!event.target?.result) {
                return reject(new Error("Failed to read file for resizing."));
            }
            const img = new Image();
            img.src = event.target.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return reject(new Error('Could not get canvas context for resizing.'));
                }
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(new File([blob], file.name, {
                            type: 'image/jpeg', // Using jpeg for consistency
                            lastModified: Date.now()
                        }));
                    } else {
                        reject(new Error('Canvas to Blob conversion failed during resize.'));
                    }
                }, 'image/jpeg', 0.95);
            };
            img.onerror = (err) => reject(new Error(`Image load error during resize: ${err}`));
        };
        reader.onerror = (err) => reject(new Error(`File reader error during resize: ${err}`));
    });
};

// Helper to convert a data URL string to a File object
const dataUrlToFile = (dataurl: string, filename: string): File => {
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
};

// Helper function to convert a File object to a Gemini API Part
const fileToPart = async (file: File): Promise<{ inlineData: { mimeType: string; data: string; } }> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
    
    const arr = dataUrl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");
    
    const mimeType = mimeMatch[1];
    const data = arr[1];
    return { inlineData: { mimeType, data } };
};

// Helper to convert File to a data URL string
const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
};

// Helper to draw a marker on an image and return a new File object
const markImage = async (
    paddedSquareFile: File, 
    position: { xPercent: number; yPercent: number; },
    originalDimensions: { originalWidth: number; originalHeight: number; }
): Promise<File> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(paddedSquareFile);
        reader.onload = (event) => {
            if (!event.target?.result) {
                return reject(new Error("Failed to read file for marking."));
            }
            const img = new Image();
            img.src = event.target.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const targetDimension = canvas.width;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return reject(new Error('Could not get canvas context for marking.'));
                }

                // Draw the original (padded) image
                ctx.drawImage(img, 0, 0);

                // Recalculate the content area's dimensions and offset within the padded square canvas.
                // This is crucial to translate the content-relative percentages to the padded canvas coordinates.
                const { originalWidth, originalHeight } = originalDimensions;
                const aspectRatio = originalWidth / originalHeight;
                let contentWidth, contentHeight;

                if (aspectRatio > 1) { // Landscape
                    contentWidth = targetDimension;
                    contentHeight = targetDimension / aspectRatio;
                } else { // Portrait or square
                    contentHeight = targetDimension;
                    contentWidth = targetDimension * aspectRatio;
                }
                
                const offsetX = (targetDimension - contentWidth) / 2;
                const offsetY = (targetDimension - contentHeight) / 2;

                // Calculate the marker's coordinates relative to the actual image content
                const markerXInContent = (position.xPercent / 100) * contentWidth;
                const markerYInContent = (position.yPercent / 100) * contentHeight;

                // The final position on the canvas is the content's offset plus the relative position
                const finalMarkerX = offsetX + markerXInContent;
                const finalMarkerY = offsetY + markerYInContent;

                // Make radius proportional to image size, but with a minimum
                const markerRadius = Math.max(5, Math.min(canvas.width, canvas.height) * 0.015);

                // Draw the marker (red circle with white outline) at the corrected coordinates
                ctx.beginPath();
                ctx.arc(finalMarkerX, finalMarkerY, markerRadius, 0, 2 * Math.PI, false);
                ctx.fillStyle = 'red';
                ctx.fill();
                ctx.lineWidth = markerRadius * 0.2;
                ctx.strokeStyle = 'white';
                ctx.stroke();

                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(new File([blob], `marked-${paddedSquareFile.name}`, {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        }));
                    } else {
                        reject(new Error('Canvas to Blob conversion failed during marking.'));
                    }
                }, 'image/jpeg', 0.95);
            };
            img.onerror = (err) => reject(new Error(`Image load error during marking: ${err}`));
        };
        reader.onerror = (err) => reject(new Error(`File reader error during marking: ${err}`));
    });
};

/**
 * Removes the background from a given product image.
 * @param imageFile The file of the product image.
 * @returns A promise that resolves to a base64 data URL of the image with a transparent background.
 */
export const removeBackground = async (imageFile: File): Promise<string> => {
    console.log('Starting background removal process...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const imagePart = await fileToPart(imageFile);
    const prompt = `Your task is to act as a precise background removal tool. Isolate the main foreground object in this image and remove its background completely. The output image must have a transparent background and be returned as a PNG. Do not add any shadows, reflections, or other elements. Only return the isolated object on a transparent background.`;
    const textPart = { text: prompt };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image-preview',
      contents: { parts: [imagePart, textPart] },
      config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });
    
    console.log('Received background removal response.');
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

    if (imagePartFromResponse?.inlineData) {
        const { mimeType, data } = imagePartFromResponse.inlineData;
        console.log(`Received image data from background removal (${mimeType}).`);
        // The model should return a PNG, but we construct the data URL safely anyway
        return `data:${mimeType};base64,${data}`;
    }

    console.error("Background removal response did not contain an image part.", response);
    throw new Error("The AI model did not return an image for background removal. Please try again.");
};

/**
 * Removes the background from an image based on a user-provided mask.
 * @param imageFile The original product image file.
 * @param maskFile The mask file where white indicates the object to keep.
 * @returns A promise resolving to the base64 data URL of the object with a transparent background.
 */
export const removeBackgroundWithMask = async (imageFile: File, maskFile: File): Promise<string> => {
    console.log('Starting brush-based background removal process...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const { width, height } = await getImageDimensions(imageFile);
    const resizedMask = await resizeImageToDimensions(maskFile, width, height);

    const imagePart = await fileToPart(imageFile);
    const maskPart = await fileToPart(resizedMask);
    
    const prompt = `**Role:** You are a precise background removal tool.
**Task:** You have been provided with two images: an 'original image' and a 'mask'. Your job is to perfectly isolate the object from the 'original image' that corresponds to the white area in the 'mask' image. Remove everything else and make the background transparent.
**Output:** Return ONLY the isolated object as a PNG with a transparent background. Do not add any shadows, reflections, or other elements.`;
    const textPart = { text: prompt };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image-preview',
      contents: { parts: [imagePart, maskPart, textPart] },
      config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });
    
    console.log('Received brush-based background removal response.');
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

    if (imagePartFromResponse?.inlineData) {
        const { mimeType, data } = imagePartFromResponse.inlineData;
        console.log(`Received image data from brush-based removal (${mimeType}).`);
        return `data:${mimeType};base64,${data}`;
    }

    console.error("Brush-based removal response did not contain an image part.", response);
    throw new Error("The AI model did not return an image for background removal. Please try again.");
};

/**
 * Inpaints a masked area of a scene image.
 * @param sceneImage The original scene image file.
 * @param maskImage The mask file (where the drawn area indicates what to remove).
 * @returns A promise resolving to the base64 data URL of the inpainted image.
 */
export const inpaintImage = async (sceneImage: File, maskImage: File): Promise<string> => {
    console.log('Starting inpainting process...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

    // Ensure scene and mask have the same dimensions for pixel-perfect alignment.
    // The mask is generated from a smaller preview, so we downscale the scene to match.
    const { width: originalWidth, height: originalHeight } = await getImageDimensions(sceneImage);
    const { width: maskWidth, height: maskHeight } = await getImageDimensions(maskImage);

    // Only resize if dimensions are different to avoid unnecessary processing
    const sceneToProcess = (originalWidth !== maskWidth || originalHeight !== maskHeight)
        ? await resizeImageToDimensions(sceneImage, maskWidth, maskHeight)
        : sceneImage;
        
    const scenePart = await fileToPart(sceneToProcess);
    const maskPart = await fileToPart(maskImage);

    const prompt = `**Role:** You are a visual content editor specializing in generative inpainting.

**Task:** You have been provided with two images.
1.  The first image is the 'scene'.
2.  The second image is the 'mask'.

Your job is to remove the content from the 'scene' that corresponds to the white area in the 'mask' image. You must then fill this area with new, AI-generated content that seamlessly and photorealistically blends with the surrounding image. The generated content must match the original scene's lighting, shadows, perspective, and texture.

**Output:** Return only the final, edited image. Do not include any text, explanations, or other content.`;
    
    const textPart = { text: prompt };

    // The order [scene, mask, text] is crucial for the model to understand the context.
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [scenePart, maskPart, textPart] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });

    console.log('Received inpainting response.');
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

    if (imagePartFromResponse?.inlineData) {
        const { mimeType, data } = imagePartFromResponse.inlineData;
        console.log(`Received image data from inpainting (${mimeType}).`);
        const resultDataUrl = `data:${mimeType};base64,${data}`;

        // If we downscaled the original scene, we need to upscale the result
        // to match the original dimensions for a high-quality output.
        if (sceneToProcess !== sceneImage) {
            const resultFile = dataUrlToFile(resultDataUrl, 'inpainted-result.jpeg');
            const finalResizedFile = await resizeImageToDimensions(resultFile, originalWidth, originalHeight);
            return fileToDataUrl(finalResizedFile);
        } else {
            return resultDataUrl;
        }
    }

    console.error("Inpainting response did not contain an image part.", response);
    throw new Error("The AI model did not return an image for inpainting. Please try again.");
};


/**
 * Generates a composite image using a multi-modal AI model.
 * @param objectImage The file for the object to be placed.
 * @param objectDescription A text description of the object.
 * @param environmentImage The file for the background environment.
 * @param environmentDescription A text description of the environment.
 * @param dropPosition The relative x/y coordinates (0-100) where the product was dropped.
 * @param scale The scaling factor for the product (1.0 is default).
 * @returns A promise that resolves to an object containing the base64 data URL of the generated image and the debug image.
 */
export const generateCompositeImage = async (
    objectImage: File, 
    objectDescription: string,
    environmentImage: File,
    environmentDescription: string,
    dropPosition: { xPercent: number; yPercent: number; },
    scale: number,
): Promise<{ finalImageUrl: string; debugImageUrl: string; finalPrompt: string; }> => {
  console.log('Starting multi-step image generation process...');
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

  // Get original scene dimensions for final cropping and correct marker placement
  const { width: originalWidth, height: originalHeight } = await getImageDimensions(environmentImage);
  
  // Define standard dimension for model inputs
  const MAX_DIMENSION = 1024;
  
  // STEP 1: Prepare images by resizing
  console.log('Resizing product and scene images...');
  const resizedObjectImage = await resizeImage(objectImage, MAX_DIMENSION);
  const resizedEnvironmentImage = await resizeImage(environmentImage, MAX_DIMENSION);

  // STEP 2: Mark the resized scene image for the description model and debug view
  console.log('Marking scene image for analysis...');
  // Pass original dimensions to correctly calculate marker position on the padded image
  const markedResizedEnvironmentImage = await markImage(resizedEnvironmentImage, dropPosition, { originalWidth, originalHeight });

  // The debug image is now the marked one.
  const debugImageUrl = await fileToDataUrl(markedResizedEnvironmentImage);


  // STEP 3: Generate semantic location description with Gemini 2.5 Flash Lite using the MARKED image
  console.log('Generating semantic location description with gemini-2.5-flash...');
  
  const markedEnvironmentImagePart = await fileToPart(markedResizedEnvironmentImage);

  const descriptionPrompt = `
You are an expert scene analyst. I will provide you with an image that has a red marker on it.
Your task is to provide a very dense, semantic description of what is at the exact location of the red marker.
Be specific about surfaces, objects, and spatial relationships. This description will be used to guide another AI in placing a new object.

Example semantic descriptions:
- "The product location is on the dark grey fabric of the sofa cushion, in the middle section, slightly to the left of the white throw pillow."
- "The product location is on the light-colored wooden floor, in the patch of sunlight coming from the window, about a foot away from the leg of the brown leather armchair."
- "The product location is on the white marble countertop, just to the right of the stainless steel sink and behind the green potted plant."

On top of the semantic description above, give a rough relative-to-image description.

Example relative-to-image descriptions:
- "The product location is about 10% away from the bottom-left of the image."
- "The product location is about 20% away from the right of the image."

Provide only the two descriptions concatenated in a few sentences.
`;
  
  let semanticLocationDescription = '';
  try {
    const descriptionResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: descriptionPrompt }, markedEnvironmentImagePart] }
    });
    semanticLocationDescription = descriptionResponse.text;
    console.log('Generated description:', semanticLocationDescription);
  } catch (error) {
    console.error('Failed to generate semantic location description:', error);
    // Fallback to a generic statement if the description generation fails
    semanticLocationDescription = `at the specified location.`;
  }

  // STEP 4: Generate composite image using the CLEAN image and the description
  console.log('Preparing to generate composite image...');
  
  const objectImagePart = await fileToPart(resizedObjectImage);
  const cleanEnvironmentImagePart = await fileToPart(resizedEnvironmentImage); // IMPORTANT: Use clean image
  
  let scaleInstruction = `The product must be scaled appropriately to look realistic in the scene.`;
  if (scale !== 1.0) {
      if (scale > 1.0) {
          const percentage = Math.round((scale - 1.0) * 100);
          scaleInstruction = `The product must be scaled to appear larger than its typical realistic size, approximately ${percentage}% larger.`;
      } else { // scale < 1.0
          const percentage = Math.round((1.0 - scale) * 100);
          scaleInstruction = `The product must be scaled to appear smaller than its typical realistic size, approximately ${percentage}% smaller.`;
      }
  }

  const prompt = `
**Role:**
You are a visual composition expert. Your task is to take a 'product' image and seamlessly integrate it into a 'scene' image, adjusting for perspective, lighting, and scale.

**Specifications:**
-   **Product to add:**
    The first image provided. It may be surrounded by black padding or background, which you should ignore and treat as transparent and only keep the product. If the product already has a transparent background (PNG), respect the transparency.
-   **Scene to use:**
    The second image provided. It may also be surrounded by black padding, which you should ignore.
-   **Placement Instruction (Crucial):**
    -   You must place the product at the location described below exactly. You should only place the product once. Use this dense, semantic description to find the exact spot in the scene.
    -   **Product location Description:** "${semanticLocationDescription}"
-   **Final Image Requirements:**
    -   The output image's style, lighting, shadows, reflections, and camera perspective must exactly match the original scene.
    -   Do not just copy and paste the product. You must intelligently re-render it to fit the context. Adjust the product's perspective and orientation to its most natural position, and ensure it casts realistic shadows according to the scene's light sources.
    -   ${scaleInstruction}
    -   The product must have proportional realism. For example, a lamp product can't be bigger than a sofa in scene.
    -   You must not return the original scene image without product placement. The product must be always present in the composite image.

The output should ONLY be the final, composed image. Do not add any text or explanation.
`;

  const textPart = { text: prompt };
  
  console.log('Sending images and augmented prompt...');
  
  const response: GenerateContentResponse = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image-preview',
    contents: { parts: [objectImagePart, cleanEnvironmentImagePart, textPart] }, // IMPORTANT: Use clean image
    config: {
        responseModalities: [Modality.IMAGE],
    },
  });

  console.log('Received response.');
  
  const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

  if (imagePartFromResponse?.inlineData) {
    const { mimeType, data } = imagePartFromResponse.inlineData;
    console.log(`Received image data (${mimeType}), length:`, data.length);
    const generatedSquareImageUrl = `data:${mimeType};base64,${data}`;
    
    console.log('Cropping generated image to original aspect ratio...');
    const finalImageUrl = await cropToOriginalAspectRatio(
        generatedSquareImageUrl,
        originalWidth,
        originalHeight,
        MAX_DIMENSION
    );
    
    return { finalImageUrl, debugImageUrl, finalPrompt: prompt };
  }

  console.error("Model response did not contain an image part.", response);
  throw new Error("The AI model did not return an image. Please try again.");
};