/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { Product } from '../types';
import Spinner from './Spinner';

interface ObjectCardProps {
    product: Product;
    isSelected: boolean;
    onClick?: () => void;
    onRemoveBackground?: () => void;
    onManualRemoveBackground?: () => void;
    isRemovingBackground?: boolean;
    disabled?: boolean;
}

const ObjectCard: React.FC<ObjectCardProps> = ({ product, isSelected, onClick, onRemoveBackground, onManualRemoveBackground, isRemovingBackground, disabled = false }) => {
    const cardClasses = `
        relative bg-white rounded-lg shadow-md overflow-hidden transition-all duration-300 group
        ${onClick ? 'cursor-pointer hover:shadow-xl hover:scale-105' : ''}
        ${isSelected ? 'border-2 border-blue-500 shadow-xl scale-105' : 'border border-zinc-200'}
    `;

    return (
        <div className={cardClasses} onClick={onClick}>
            {isRemovingBackground && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 animate-fade-in">
                    <Spinner />
                    <p className="text-sm font-semibold text-zinc-600 mt-2">Removing...</p>
                </div>
            )}
            <div className="aspect-square w-full bg-zinc-100 flex items-center justify-center">
                <img src={product.imageUrl} alt={product.name} className="w-full h-full object-contain" />
            </div>
             {onRemoveBackground && onManualRemoveBackground && (
                <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                     <div className="bg-black/40 backdrop-blur-sm p-2 rounded-lg">
                        <p className="text-white text-xs font-bold text-center mb-2">Remove Background</p>
                        <div className="flex justify-center gap-2">
                            <button 
                                onClick={(e) => { e.stopPropagation(); onRemoveBackground(); }}
                                disabled={disabled || isRemovingBackground}
                                className="w-full bg-white/90 text-zinc-900 text-xs font-bold py-1.5 px-2 rounded-md hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                aria-label="Automatically remove background"
                            >
                                Auto
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); onManualRemoveBackground(); }}
                                disabled={disabled || isRemovingBackground}
                                className="w-full bg-white/90 text-zinc-900 text-xs font-bold py-1.5 px-2 rounded-md hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                aria-label="Remove background with brush"
                            >
                                Brush
                            </button>
                        </div>
                    </div>
                </div>
             )}
            <div className="p-3 text-center">
                <h4 className="text-sm font-semibold text-zinc-700 truncate">{product.name}</h4>
            </div>
        </div>
    );
};

export default ObjectCard;