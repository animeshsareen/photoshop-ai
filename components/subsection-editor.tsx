"use client";
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Brush as BrushIcon,
  Square as SquareIcon,
  Palette as PaletteIcon,
  Minus as SizeIcon,
  Undo2 as UndoIcon,
  Trash2 as TrashIcon,
  Check as CheckIcon,
  X as CloseIcon,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Basic shape types
export type SubSelectionShape =
  | { id: string; type: 'rect'; x: number; y: number; width: number; height: number; color: string }
  | { id: string; type: 'circle'; x: number; y: number; radius: number; color: string }
  | { id: string; type: 'brush'; points: number[]; strokeWidth: number; color: string };

export interface SubsectionEditorValue {
  shapes: SubSelectionShape[];
  maskDataUrl?: string; // optional exported raster mask
  imageNaturalWidth: number;
  imageNaturalHeight: number;
  /** Composite of original image + user drawn shapes (for preview / alt input) */
  editedImageDataUrl?: string;
}

interface Props {
  imageUrl: string;
  onConfirm: (value: SubsectionEditorValue) => void;
  onCancel: () => void;
  initialValue?: SubsectionEditorValue | null;
  className?: string;
}

// Very lightweight editor: supports brush + rectangle for MVP
export const SubsectionEditor: React.FC<Props> = ({ imageUrl, onConfirm, onCancel, initialValue, className }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null); // drawing layer
  const [stageSize, setStageSize] = useState({ width: 400, height: 400 });
  const [loadingImg, setLoadingImg] = useState(true);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<'brush' | 'rect' | 'move'>('brush');
  const [brushSize, setBrushSize] = useState(18);
  // Default drawing color set to bright red for higher visibility
  const [color, setColor] = useState('#ff0000');
  const [collapsed, setCollapsed] = useState(false);
  const [shapes, setShapes] = useState<SubSelectionShape[]>(initialValue?.shapes || []);
  const [drawingRect, setDrawingRect] = useState<null | { id: string; x: number; y: number; width: number; height: number }>(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef<{x:number;y:number}|null>(null)

  // Load image to get natural size
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageElement(img);
      setLoadingImg(false);
      // Fit inside container width while preserving aspect
      if (containerRef.current) {
        const maxW = containerRef.current.clientWidth;
        const scale = Math.min(1, maxW / img.width);
        setStageSize({ width: img.width * scale, height: img.height * scale });
      } else {
        setStageSize({ width: img.width, height: img.height });
      }
      // draw base image on base canvas
      requestAnimationFrame(()=>{
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            ctx.clearRect(0,0,canvasRef.current.width, canvasRef.current.height);
            ctx.drawImage(img,0,0,canvasRef.current.width, canvasRef.current.height);
          }
        }
      })
    };
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
  }, [imageUrl]);

  // Redraw base image if stage size changes
  useEffect(()=>{
    if (imageElement && canvasRef.current) {
      canvasRef.current.width = stageSize.width;
      canvasRef.current.height = stageSize.height;
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.drawImage(imageElement,0,0,stageSize.width, stageSize.height);
      if (overlayRef.current) { overlayRef.current.width = stageSize.width; overlayRef.current.height = stageSize.height; }
      redrawOverlay();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageSize.width, stageSize.height]);

  const relativePos = (evt: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = (evt.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  };

  const redrawOverlay = () => {
    const ctx = overlayRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0,0,stageSize.width, stageSize.height);
    // existing shapes
    shapes.forEach(shape => {
      if (shape.type === 'brush') {
        ctx.strokeStyle = shape.color || '#ff0202ff';
        ctx.lineWidth = shape.strokeWidth;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i=0;i<shape.points.length;i+=2){
          const x = shape.points[i];
            const y = shape.points[i+1];
          if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.stroke();
      } else if (shape.type === 'rect') {
        ctx.strokeStyle = shape.color || '#6366f1';
        ctx.setLineDash([4,4]);
        ctx.lineWidth = 2;
        ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
        ctx.setLineDash([]);
      } else if (shape.type === 'circle') {
        ctx.strokeStyle = shape.color || '#6366f1';
        ctx.setLineDash([4,4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI*2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    // drafting rect
    if (drawingRect) {
      ctx.strokeStyle = '#6366f1';
      ctx.setLineDash([4,4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(drawingRect.x, drawingRect.y, drawingRect.width, drawingRect.height);
      ctx.setLineDash([]);
    }
  };

  useEffect(()=>{ redrawOverlay() }, [shapes, drawingRect, stageSize]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'brush') {
      isDrawing.current = true;
      const pos = relativePos(e);
      lastPoint.current = pos;
      const newLine: SubSelectionShape = { id: crypto.randomUUID(), type: 'brush', points: [pos.x, pos.y], strokeWidth: brushSize, color };
      setShapes(prev => [...prev, newLine]);
    } else if (tool === 'rect') {
      const pos = relativePos(e);
      const rect = { id: crypto.randomUUID(), type: 'rect' as const, x: pos.x, y: pos.y, width: 0, height: 0, color };
      setDrawingRect(rect);
      setShapes(prev => [...prev, rect]);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current && !drawingRect) return;
    const pos = relativePos(e);
  if (tool === 'brush' && isDrawing.current) {
      setShapes(prev => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.type === 'brush') {
          last.points.push(pos.x, pos.y);
        }
        return copy;
      });
    } else if (tool === 'rect' && drawingRect) {
      setDrawingRect(r => r && { ...r, width: pos.x - r.x, height: pos.y - r.y });
      setShapes(prev => prev.map(s => s.id === drawingRect.id ? { ...drawingRect, width: pos.x - drawingRect.x, height: pos.y - drawingRect.y, type: 'rect' } : s) as SubSelectionShape[]);
    }
  };

  const handlePointerUp = () => { isDrawing.current = false; lastPoint.current = null; setDrawingRect(null); };

  const undo = () => setShapes(prev => prev.slice(0, -1));
  const clear = () => setShapes([]);

  const exportMask = useCallback((): string | undefined => {
    if (!imageElement) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = imageElement.naturalWidth;
    canvas.height = imageElement.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    // Draw shapes in white on black background
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'white';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const scaleX = imageElement.naturalWidth / stageSize.width;
    const scaleY = imageElement.naturalHeight / stageSize.height;
    shapes.forEach(shape => {
      if (shape.type === 'brush') {
        ctx.lineWidth = shape.strokeWidth * scaleX; // approximate
        ctx.beginPath();
        for (let i = 0; i < shape.points.length; i += 2) {
          const x = shape.points[i] * scaleX;
          const y = shape.points[i + 1] * scaleY;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (shape.type === 'rect') {
        ctx.fillStyle = 'white';
        ctx.fillRect(shape.x * scaleX, shape.y * scaleY, shape.width * scaleX, shape.height * scaleY);
        ctx.fillStyle = 'black';
      } else if (shape.type === 'circle') {
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(shape.x * scaleX, shape.y * scaleY, shape.radius * scaleX, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'black';
      }
    });
    return canvas.toDataURL('image/png');
  }, [imageElement, shapes, stageSize]);

  const confirm = () => {
    const mask = exportMask();
    // Build composite edited image (original + vector overlay) at natural resolution
    let editedImageDataUrl: string | undefined;
    if (imageElement) {
      const canvas = document.createElement('canvas');
      canvas.width = imageElement.naturalWidth;
      canvas.height = imageElement.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        const scaleX = imageElement.naturalWidth / stageSize.width;
        const scaleY = imageElement.naturalHeight / stageSize.height;
        shapes.forEach(shape => {
          if (shape.type === 'brush') {
            ctx.strokeStyle = shape.color;
            ctx.lineWidth = shape.strokeWidth * scaleX;
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.beginPath();
            for (let i=0;i<shape.points.length;i+=2){
              const x = shape.points[i] * scaleX;
              const y = shape.points[i+1] * scaleY;
              if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
            }
            ctx.stroke();
          } else if (shape.type === 'rect') {
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = shape.color;
            ctx.fillRect(shape.x*scaleX, shape.y*scaleY, shape.width*scaleX, shape.height*scaleY);
            ctx.restore();
            ctx.strokeStyle = shape.color;
            ctx.lineWidth = 2 * scaleX;
            ctx.strokeRect(shape.x*scaleX, shape.y*scaleY, shape.width*scaleX, shape.height*scaleY);
          } else if (shape.type === 'circle') {
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = shape.color;
            ctx.beginPath();
            ctx.arc(shape.x*scaleX, shape.y*scaleY, shape.radius*scaleX, 0, Math.PI*2);
            ctx.fill();
            ctx.restore();
            ctx.strokeStyle = shape.color;
            ctx.lineWidth = 2 * scaleX;
            ctx.beginPath();
            ctx.arc(shape.x*scaleX, shape.y*scaleY, shape.radius*scaleX, 0, Math.PI*2);
            ctx.stroke();
          }
        });
        editedImageDataUrl = canvas.toDataURL('image/png');
      }
    }
    onConfirm({
      shapes,
      maskDataUrl: mask,
      imageNaturalWidth: imageElement?.naturalWidth || stageSize.width,
      imageNaturalHeight: imageElement?.naturalHeight || stageSize.height,
      editedImageDataUrl,
    });
  };

  return (
    <div className={cn('relative flex', className)}>
      <div className={cn('flex flex-col bg-muted/40 border rounded-md p-2 gap-2 transition-all duration-200', collapsed ? 'w-12' : 'w-40')}>
        <button
          type="button"
          onClick={()=> setCollapsed(c => !c)}
          className="flex items-center gap-2 text-xs font-medium rounded-md px-2 py-1 hover:bg-muted focus:outline-none"
        >
          {collapsed ? <ChevronsRight className="w-4 h-4"/> : <ChevronsLeft className="w-4 h-4"/>}
          {!collapsed && <span>Toolbar</span>}
        </button>
        <ToolButton active={tool==='brush'} collapsed={collapsed} label="Brush" icon={<BrushIcon className="w-4 h-4"/>} onClick={()=> setTool('brush')} />
        <ToolButton active={tool==='rect'} collapsed={collapsed} label="Shape" icon={<SquareIcon className="w-4 h-4"/>} onClick={()=> setTool('rect')} />
        <div className={cn('flex flex-col gap-2 rounded-md', collapsed ? 'items-center' : '')}>
          <div className={cn('flex', collapsed ? 'flex-col items-center gap-1' : 'items-center gap-2')}>
            <PaletteIcon className="w-4 h-4"/>
            {!collapsed && <span className="text-xs font-medium">Color</span>}
          </div>
          <input
            type="color"
            value={color}
            onChange={e=> setColor(e.target.value)}
            className={cn('h-8 w-8 cursor-pointer rounded shadow-inner border p-0')}
            aria-label="Brush Color"
          />
        </div>
        {!collapsed && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <SizeIcon className="w-4 h-4"/>
              <span className="text-xs font-medium">Size</span>
            </div>
            <div className="w-full">
              <Slider value={[brushSize]} min={4} max={64} step={2} onValueChange={v => setBrushSize(v[0])} />
            </div>
            <span className="text-[10px] text-muted-foreground">{brushSize}px</span>
          </div>
        )}
        <ToolButton disabled={!shapes.length} collapsed={collapsed} label="Undo" icon={<UndoIcon className="w-4 h-4"/>} onClick={undo} />
        <ToolButton disabled={!shapes.length} collapsed={collapsed} label="Clear" icon={<TrashIcon className="w-4 h-4"/>} onClick={clear} />
        <div className="mt-auto flex flex-col gap-2">
          <ToolButton variant="ghost" collapsed={collapsed} label="Cancel" icon={<CloseIcon className="w-4 h-4"/>} onClick={onCancel} />
          <ToolButton disabled={!shapes.length} collapsed={collapsed} label="Confirm" icon={<CheckIcon className="w-4 h-4"/>} onClick={confirm} />
        </div>
      </div>
      <div ref={containerRef} className="relative border rounded-md ml-3 p-1 bg-background flex-1 overflow-auto" style={{ maxWidth: '100%' }}>
        {loadingImg && <div className="text-xs p-2">Loading image...</div>}
        {!loadingImg && (
          <div style={{ position:'relative', width: stageSize.width, height: stageSize.height }}>
            <canvas
              ref={canvasRef}
              width={stageSize.width}
              height={stageSize.height}
              className="block select-none"
              style={{ position:'absolute', top:0, left:0 }}
            />
            <canvas
              ref={overlayRef}
              width={stageSize.width}
              height={stageSize.height}
              className="block touch-none select-none cursor-crosshair"
              style={{ position:'absolute', top:0, left:0 }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default SubsectionEditor;

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  collapsed: boolean;
  variant?: 'ghost' | 'default';
}

const ToolButton: React.FC<ToolButtonProps> = ({ icon, label, onClick, active, disabled, collapsed, variant='default' }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors border',
        collapsed ? 'justify-center' : 'justify-start',
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted',
  active ? 'bg-primary text-primary-foreground hover:bg-primary shadow-sm' : 'bg-background',
        variant === 'ghost' && !active ? 'bg-transparent border-transparent hover:bg-muted' : '',
      )}
      aria-pressed={active}
    >
      {icon}
      {!collapsed && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
};
