/**
 * Accessible drag-and-drop image picker with local preview, client-side size guard
 * and a normalised-bbox overlay renderer used by both analysis modules.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, RotateCcw, ShieldAlert, Sparkles, X } from 'lucide-react';
import { Badge, Button } from './Primitives';
import { api } from '../../lib/api';
import { bytes } from '../../lib/format';

const MAX_BYTES = 12 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export function ImageDropzone({ file, previewUrl, onSelect, onClear, disabled, label = 'Site photograph', samples = [] }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [loadingSample, setLoadingSample] = useState(null);

  const pickSample = async (sample) => {
    setLoadingSample(sample.id);
    setLocalError(null);
    try {
      onSelect(await api.loadSample(sample));
    } catch {
      setLocalError('Could not load the sample image. Is the backend running?');
    } finally {
      setLoadingSample(null);
    }
  };

  const accept = useCallback(
    (candidate) => {
      setLocalError(null);
      if (!candidate) return;
      if (!ACCEPTED.includes(candidate.type)) {
        setLocalError('Only JPEG, PNG or WebP images are accepted.');
        return;
      }
      if (candidate.size > MAX_BYTES) {
        setLocalError(`That file is ${bytes(candidate.size)}. The limit is ${bytes(MAX_BYTES)}.`);
        return;
      }
      onSelect(candidate);
    },
    [onSelect],
  );

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    accept(event.dataTransfer.files?.[0]);
  };

  // Paste support: engineers screenshot a lot.
  useEffect(() => {
    if (disabled) return undefined;
    const onPaste = (event) => {
      const item = Array.from(event.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
      if (item) accept(item.getAsFile());
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [accept, disabled]);

  if (file && previewUrl) {
    return (
      <div className="space-y-2">
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
          <img src={previewUrl} alt={`Preview of ${file.name}`} className="max-h-[260px] w-full object-contain" />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
            <Badge tone="slate" className="!bg-slate-900/80 !text-white !ring-slate-700 backdrop-blur">
              {file.name.length > 26 ? `${file.name.slice(0, 24)}…` : file.name}
            </Badge>
            <Badge tone="slate" className="!bg-slate-900/80 !text-white !ring-slate-700 backdrop-blur">
              {bytes(file.size)}
            </Badge>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            aria-label="Remove image"
            className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-slate-900/80 text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] text-slate-500">Ready to analyse.</p>
          <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => inputRef.current?.click()} disabled={disabled}>
            Replace
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        aria-label={label}
        className={`group flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 ${
          dragging
            ? 'border-accent-500 bg-accent-50'
            : 'border-slate-300 bg-slate-50/60 hover:border-accent-400 hover:bg-accent-50/40'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <span
          className={`grid h-11 w-11 place-items-center rounded-xl transition ${
            dragging ? 'bg-accent-600 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200 group-hover:text-accent-600'
          }`}
        >
          <ImagePlus size={20} strokeWidth={1.9} />
        </span>
        <p className="mt-3 text-sm font-medium text-slate-700">
          {dragging ? 'Drop to attach' : 'Drop a photo, paste, or click to browse'}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">JPEG · PNG · WebP — up to 12 MB</p>
      </div>
      {localError ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-red-600">
          <ShieldAlert size={12} /> {localError}
        </p>
      ) : null}

      {samples.length ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <Sparkles size={10} /> Try a sample
          </span>
          {samples.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                pickSample(sample);
              }}
              disabled={disabled || loadingSample !== null}
              title={sample.note}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10.5px] font-medium text-slate-600 transition hover:border-accent-300 hover:bg-accent-50 hover:text-accent-800 disabled:opacity-50"
            >
              {loadingSample === sample.id ? <Loader2 size={10} className="animate-spin" /> : null}
              {sample.label}
            </button>
          ))}
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={(e) => accept(e.target.files?.[0])}
      />
    </div>
  );
}

/**
 * Overlays normalised (0..1) bounding boxes on top of the analysed image.
 * Boxes are always drawn inside the rendered image element, so they stay aligned
 * regardless of aspect ratio because the container matches the image box exactly.
 */
export function BBoxOverlay({ src, boxes = [], accent = '#f59e0b' }) {
  return (
    <div className="relative inline-block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
      <img src={src} alt="Analysed frame with detected regions" className="block max-h-[420px] w-full object-contain" />
      {boxes.map((box, i) => (
        <div key={`${box.label || 'box'}-${i}`} className="pointer-events-none absolute" style={{ inset: 0 }}>
          <div
            className="absolute rounded-sm ring-2 ring-inset"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              borderColor: accent,
              boxShadow: `0 0 0 2px ${accent}33`,
            }}
          >
            {box.label ? (
              <span
                className="absolute -top-[18px] left-0 whitespace-nowrap rounded-t px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white"
                style={{ backgroundColor: accent }}
              >
                {box.label}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default ImageDropzone;
