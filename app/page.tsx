"use client";
/* eslint-disable @next/next/no-img-element -- user-selected object URLs must stay browser-local */

import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Layout = "2-up" | "4-up";
type View = "upload" | "edit" | "complete";

type Photo = {
  id: string;
  name: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  aspectRatio: number;
};

type Transform = {
  rotation: 0 | 90 | 180 | 270;
  scale: number;
  offsetX: number; // normalized to cell width
  offsetY: number; // normalized to cell height
};

type Cell = {
  id: string;
  photoId: string | null;
  transform: Transform;
  autoRotated: boolean;
};

type CollagePage = {
  id: string;
  layout: Layout;
  gapMm: number;
  cells: Cell[];
};

type ExportFile = { name: string; blob: Blob; url: string };

const PAPER_WIDTH = 1181;
const PAPER_HEIGHT = 1748;
const DEFAULT_GAP = 0.5;
const MM_TO_PX = 300 / 25.4;
const DEFAULT_TRANSFORM: Transform = {
  rotation: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    upload: <><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></>,
    rotate: <><path d="M20 7v5h-5"/><path d="M19 12a7.5 7.5 0 1 1-2.2-5.3L20 9"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    minus: <path d="M5 12h14"/>,
    reset: <><path d="M4 4v6h6"/><path d="M5.5 15a7 7 0 1 0 .5-7.5L4 10"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    arrow: <path d="m9 18 6-6-6-6"/>,
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function cellAspect(layout: Layout) {
  return layout === "2-up" ? 100 / 73.75 : 49.75 / 73.75;
}

function coverUtilization(photoAspect: number, targetAspect: number) {
  if (
    !Number.isFinite(photoAspect) ||
    !Number.isFinite(targetAspect) ||
    photoAspect <= 0 ||
    targetAspect <= 0
  ) return 0;

  return Math.min(photoAspect, targetAspect) / Math.max(photoAspect, targetAspect);
}

function shouldAutoRotate(photoAspect: number, targetAspect: number) {
  const normalScore = coverUtilization(photoAspect, targetAspect);
  const rotatedScore = coverUtilization(1 / photoAspect, targetAspect);

  // Only rotate when the usable image area improves by at least 5%.
  // This avoids pointless rotations for nearly square photos.
  return rotatedScore > normalScore * 1.05;
}

function makeCell(photo: Photo | null, layout: Layout): Cell {
  const auto = photo ? shouldAutoRotate(photo.aspectRatio, cellAspect(layout)) : false;
  return {
    id: uid(),
    photoId: photo?.id ?? null,
    autoRotated: auto,
    transform: { ...DEFAULT_TRANSFORM, rotation: auto ? 90 : 0 },
  };
}

function makePage(layout: Layout, photos: Photo[] = [], gapMm = DEFAULT_GAP): CollagePage {
  const count = layout === "2-up" ? 2 : 4;
  return {
    id: uid(),
    layout,
    gapMm,
    cells: Array.from({ length: count }, (_, index) => makeCell(photos[index] ?? null, layout)),
  };
}

async function readPhoto(file: File): Promise<Photo> {
  const sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = sourceUrl;
  await image.decode();

  let src = sourceUrl;
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const maxSide = Math.max(width, height);

  if (maxSide > 4096 || file.size > 20 * 1024 * 1024) {
    const ratio = Math.min(1, 4096 / maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片压缩失败")), "image/jpeg", 0.94),
    );
    URL.revokeObjectURL(sourceUrl);
    src = URL.createObjectURL(blob);
    width = canvas.width;
    height = canvas.height;
  }

  return {
    id: uid(),
    name: file.name,
    src,
    naturalWidth: width,
    naturalHeight: height,
    aspectRatio: width / height,
  };
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function loadImage(src: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  return image;
}

function pageRects(page: CollagePage) {
  const gap = Math.round(page.gapMm * MM_TO_PX);
  if (page.layout === "2-up") {
    const topHeight = Math.floor((PAPER_HEIGHT - gap) / 2);
    const bottomHeight = PAPER_HEIGHT - gap - topHeight;
    return [
      { x: 0, y: 0, width: PAPER_WIDTH, height: topHeight },
      { x: 0, y: topHeight + gap, width: PAPER_WIDTH, height: bottomHeight },
    ];
  }
  const width = (PAPER_WIDTH - gap) / 2;
  const height = (PAPER_HEIGHT - gap) / 2;
  return [
    { x: 0, y: 0, width, height },
    { x: width + gap, y: 0, width, height },
    { x: 0, y: height + gap, width, height },
    { x: width + gap, y: height + gap, width, height },
  ];
}

async function renderPage(page: CollagePage, photos: Photo[]) {
  const canvas = document.createElement("canvas");
  canvas.width = PAPER_WIDTH;
  canvas.height = PAPER_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("当前浏览器无法创建导出画布");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAPER_WIDTH, PAPER_HEIGHT);
  const rects = pageRects(page);

  for (let index = 0; index < page.cells.length; index += 1) {
    const cell = page.cells[index];
    if (!cell.photoId) continue;
    const photo = photos.find((item) => item.id === cell.photoId);
    if (!photo) continue;
    const image = await loadImage(photo.src);
    const rect = rects[index];
    const { rotation, scale, offsetX, offsetY } = cell.transform;
    const odd = rotation % 180 !== 0;
    const localTargetWidth = odd ? rect.height : rect.width;
    const localTargetHeight = odd ? rect.width : rect.height;
    const cover = Math.max(localTargetWidth / image.naturalWidth, localTargetHeight / image.naturalHeight);
    const drawWidth = image.naturalWidth * cover;
    const drawHeight = image.naturalHeight * cover;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.translate(
      rect.x + rect.width / 2 + offsetX * rect.width,
      rect.y + rect.height / 2 + offsetY * rect.height,
    );
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
  }

  return new Promise<Blob>((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("JPEG 生成失败")), "image/jpeg", 0.95);
      return;
    }
    try {
      const data = atob(canvas.toDataURL("image/jpeg", 0.95).split(",")[1]);
      const bytes = Uint8Array.from(data, (char) => char.charCodeAt(0));
      resolve(new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" }));
    } catch (error) {
      reject(error);
    }
  });
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function joinBytes(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

async function makeZip(files: { name: string; blob: Blob }[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }

  const central = joinBytes(centralParts);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, localOffset, true);
  const zipBytes = joinBytes([...localParts, central, end]);
  return new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/zip" });
}

function UploadView({ photos, onFiles, onStart, loading, error }: {
  photos: Photo[];
  onFiles: (files: File[]) => void;
  onStart: () => void;
  loading: boolean;
  error: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    onFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <main className="upload-shell">
      <header className="landing-header">
        <div className="brand"><span className="brand-mark"><Icon name="image" size={19}/></span><span>相片拼贴</span></div>
        <span className="local-badge"><span/>照片仅在本机处理</span>
      </header>
      <section className="upload-hero">
        <div className="eyebrow">6 英寸相纸 · 300 DPI</div>
        <h1>把喜欢的照片，<br/><em>恰好</em>放进一张相纸。</h1>
        <p>上传照片，自由调整取景，一键生成可直接冲印的高清文件。</p>
        <div
          className={`drop-zone ${dragging ? "is-dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
        >
          <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png" multiple onChange={(e) => onFiles(Array.from(e.target.files ?? []))}/>
          <div className="upload-icon"><Icon name="upload" size={28}/></div>
          <strong>{loading ? "正在读取照片…" : "拖入照片，或点击选择"}</strong>
          <span>支持 JPG、PNG，可一次选择多张</span>
        </div>
        {error && <div className="inline-error">{error}</div>}
        {photos.length > 0 && (
          <div className="upload-results">
            <div className="result-heading"><span>已选择 {photos.length} 张</span><button onClick={() => inputRef.current?.click()}>继续添加</button></div>
            <div className="result-grid">
              {photos.slice(0, 8).map((photo, index) => (
                <div className="result-thumb" key={photo.id}>
                  <img src={photo.src} alt={photo.name}/>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
              ))}
              {photos.length > 8 && <div className="more-tile">+{photos.length - 8}</div>}
            </div>
            <button className="primary large" onClick={onStart}>进入编辑器 <Icon name="arrow"/></button>
          </div>
        )}
      </section>
      <footer className="landing-footer"><span>100 × 148 mm</span><span>自动旋转与裁切</span><span>原图不上传服务器</span></footer>
    </main>
  );
}

function PhotoCell({ cell, photo, selected, onSelect, onUpdate, onRotate, onReset, onDropPhoto }: {
  cell: Cell;
  photo?: Photo;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (transform: Transform) => void;
  onRotate: () => void;
  onReset: () => void;
  onDropPhoto: (photoId: string, sourceCellId?: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number; distance: number; scale: number } | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    if (!ref.current) return;
    const update = () => {
      const box = ref.current?.getBoundingClientRect();
      if (box) setSize({ width: box.width, height: box.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const imageSize = useMemo(() => {
    if (!photo) return { width: 0, height: 0 };
    const odd = cell.transform.rotation % 180 !== 0;
    const targetW = odd ? size.height : size.width;
    const targetH = odd ? size.width : size.height;
    const cover = Math.max(targetW / photo.naturalWidth, targetH / photo.naturalHeight);
    return { width: photo.naturalWidth * cover, height: photo.naturalHeight * cover };
  }, [photo, size, cell.transform.rotation]);

  const beginGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!photo || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const values = Array.from(pointers.current.values());
    if (values.length === 1) {
      gesture.current = { startX: values[0].x, startY: values[0].y, offsetX: cell.transform.offsetX, offsetY: cell.transform.offsetY, distance: 0, scale: cell.transform.scale };
    } else if (values.length === 2) {
      gesture.current = { startX: 0, startY: 0, offsetX: cell.transform.offsetX, offsetY: cell.transform.offsetY, distance: Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y), scale: cell.transform.scale };
    }
    onSelect();
  };

  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const values = Array.from(pointers.current.values());
    if (values.length === 1) {
      const dx = (values[0].x - gesture.current.startX) / size.width;
      const dy = (values[0].y - gesture.current.startY) / size.height;
      const odd = cell.transform.rotation % 180 !== 0;
      const finalWidth = (odd ? imageSize.height : imageSize.width) * cell.transform.scale;
      const finalHeight = (odd ? imageSize.width : imageSize.height) * cell.transform.scale;
      const maxX = Math.max(0, (finalWidth - size.width) / 2) / size.width;
      const maxY = Math.max(0, (finalHeight - size.height) / 2) / size.height;
      onUpdate({ ...cell.transform, offsetX: Math.max(-maxX, Math.min(maxX, gesture.current.offsetX + dx)), offsetY: Math.max(-maxY, Math.min(maxY, gesture.current.offsetY + dy)) });
    } else if (values.length === 2) {
      const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
      const nextScale = Math.max(1, Math.min(4, gesture.current.scale * (distance / Math.max(gesture.current.distance, 1))));
      onUpdate({ ...cell.transform, scale: nextScale });
    }
  };

  const endGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const photoId = event.dataTransfer.getData("photoId");
    const sourceCellId = event.dataTransfer.getData("sourceCellId") || undefined;
    if (photoId) onDropPhoto(photoId, sourceCellId);
  };

  return (
    <div
      ref={ref}
      className={`photo-cell ${selected ? "selected" : ""} ${photo ? "filled" : "empty"}`}
      onPointerDown={beginGesture}
      onPointerMove={moveGesture}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onDoubleClick={() => photo && onReset()}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      draggable={Boolean(photo)}
      onDragStart={(event) => {
        if (!photo) return;
        event.dataTransfer.setData("photoId", photo.id);
        event.dataTransfer.setData("sourceCellId", cell.id);
      }}
    >
      {photo ? (
        <img
          src={photo.src}
          alt=""
          className="cell-photo"
          draggable={false}
          style={{
            width: imageSize.width,
            height: imageSize.height,
            transform: `translate(calc(-50% + ${cell.transform.offsetX * size.width}px), calc(-50% + ${cell.transform.offsetY * size.height}px)) rotate(${cell.transform.rotation}deg) scale(${cell.transform.scale})`,
          }}
        />
      ) : (
        <div className="empty-cell"><Icon name="plus"/><span>拖入照片</span></div>
      )}
      {photo && (
        <div className="cell-controls">
          <button aria-label="旋转照片" title="旋转 90°" onClick={(event) => { event.stopPropagation(); onRotate(); }}><Icon name="rotate" size={16}/></button>
          <button aria-label="重置照片" title="重置位置" onClick={(event) => { event.stopPropagation(); onReset(); }}><Icon name="reset" size={16}/></button>
        </div>
      )}
      {selected && photo && <div className="selection-grid"/>}
    </div>
  );
}

function CompleteView({ files, zipFile, onContinue, onRestart }: {
  files: ExportFile[];
  zipFile: ExportFile | null;
  onContinue: () => void;
  onRestart: () => void;
}) {
  return (
    <main className="complete-shell">
      <section className="complete-card">
        <div className="success-icon"><Icon name="check" size={30}/></div>
        <div className="eyebrow">导出完成</div>
        <h1>{files.length} 页相纸已准备好</h1>
        <p>每页均为 1181 × 1748 px、300 DPI 标准 6 英寸冲印尺寸。</p>
        <div className="download-list">
          {zipFile ? (
            <a className="download-row featured" href={zipFile.url} download={zipFile.name}>
              <span className="file-icon">ZIP</span><span><strong>{zipFile.name}</strong><small>包含 {files.length} 张 JPEG</small></span><Icon name="download"/>
            </a>
          ) : files.map((file) => (
            <a className="download-row featured" href={file.url} download={file.name} key={file.name}>
              <span className="file-icon">JPG</span><span><strong>{file.name}</strong><small>300 DPI 高清文件</small></span><Icon name="download"/>
            </a>
          ))}
        </div>
        <div className="complete-actions"><button className="primary" onClick={onContinue}>继续编辑</button><button className="secondary" onClick={onRestart}>重新开始</button></div>
      </section>
    </main>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("upload");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pages, setPages] = useState<CollagePage[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [error, setError] = useState("");
  const [exportFiles, setExportFiles] = useState<ExportFile[]>([]);
  const [zipFile, setZipFile] = useState<ExportFile | null>(null);
  const editInput = useRef<HTMLInputElement>(null);

  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const selectedCell = activePage?.cells.find((cell) => cell.id === selectedCellId);
  const assigned = useMemo(() => new Set(pages.flatMap((page) => page.cells.map((cell) => cell.photoId).filter(Boolean))), [pages]);

  const addFiles = useCallback(async (files: File[]) => {
    const valid = files.filter((file) => ["image/jpeg", "image/png"].includes(file.type));
    if (valid.length !== files.length) setError("已忽略非 JPG / PNG 文件"); else setError("");
    if (!valid.length) return;
    setLoadingPhotos(true);
    try {
      const loaded = await Promise.all(valid.map(readPhoto));
      setPhotos((current) => [...current, ...loaded]);
    } catch {
      setError("有照片无法读取，请换一张再试");
    } finally {
      setLoadingPhotos(false);
    }
  }, []);

  const startEditing = () => {
    const nextPages: CollagePage[] = [];
    for (let index = 0; index < photos.length; index += 2) nextPages.push(makePage("2-up", photos.slice(index, index + 2)));
    if (!nextPages.length) nextPages.push(makePage("2-up"));
    setPages(nextPages);
    setActivePageId(nextPages[0].id);
    setSelectedCellId(nextPages[0].cells[0].id);
    setView("edit");
  };

  const updateCell = useCallback((cellId: string, update: (cell: Cell) => Cell) => {
    setPages((current) => current.map((page) => ({ ...page, cells: page.cells.map((cell) => cell.id === cellId ? update(cell) : cell) })));
  }, []);

  const assignPhoto = (targetCellId: string, photoId: string, sourceCellId?: string) => {
    const targetPage = pages.find((page) => page.cells.some((cell) => cell.id === targetCellId));
    const photo = photos.find((item) => item.id === photoId);
    if (!targetPage || !photo) return;
    const target = targetPage.cells.find((cell) => cell.id === targetCellId);
    const displacedId = target?.photoId ?? null;
    const auto = shouldAutoRotate(photo.aspectRatio, cellAspect(targetPage.layout));
    setPages((current) => current.map((page) => ({
      ...page,
      cells: page.cells.map((cell) => {
        if (cell.id === targetCellId) return { ...cell, photoId, autoRotated: auto, transform: { ...DEFAULT_TRANSFORM, rotation: auto ? 90 : 0 } };
        if (sourceCellId && cell.id === sourceCellId) {
          if (!displacedId) return { ...cell, photoId: null, transform: { ...DEFAULT_TRANSFORM }, autoRotated: false };
          const displaced = photos.find((item) => item.id === displacedId);
          const rotated = displaced ? shouldAutoRotate(displaced.aspectRatio, cellAspect(page.layout)) : false;
          return { ...cell, photoId: displacedId, autoRotated: rotated, transform: { ...DEFAULT_TRANSFORM, rotation: rotated ? 90 : 0 } };
        }
        if (!sourceCellId && cell.photoId === photoId) return { ...cell, photoId: null, transform: { ...DEFAULT_TRANSFORM }, autoRotated: false };
        return cell;
      }),
    })));
    setSelectedCellId(targetCellId);
  };

  const quickAssign = (photoId: string) => {
    if (selectedCellId) { assignPhoto(selectedCellId, photoId); return; }
    const empty = activePage?.cells.find((cell) => !cell.photoId);
    if (empty) assignPhoto(empty.id, photoId);
  };

  const setLayout = (layout: Layout) => {
    if (!activePage || activePage.layout === layout) return;
    const count = layout === "2-up" ? 2 : 4;
    const currentPhotos = activePage.cells.map((cell) => photos.find((photo) => photo.id === cell.photoId)).filter(Boolean) as Photo[];
    const nextCells = Array.from({ length: count }, (_, index) => makeCell(currentPhotos[index] ?? null, layout));
    setPages((current) => current.map((page) => page.id === activePage.id ? { ...page, layout, cells: nextCells } : page));
    setSelectedCellId(nextCells[0].id);
  };

  const setGap = (gapMm: number) => setPages((current) => current.map((page) => ({ ...page, gapMm })));

  const addPage = () => {
    const page = makePage(activePage?.layout ?? "2-up", [], activePage?.gapMm ?? DEFAULT_GAP);
    setPages((current) => [...current, page]);
    setActivePageId(page.id);
    setSelectedCellId(page.cells[0].id);
  };

  const removePage = () => {
    if (!activePage || pages.length <= 1) return;
    const remaining = pages.filter((page) => page.id !== activePage.id);
    setPages(remaining);
    setActivePageId(remaining[0].id);
    setSelectedCellId(remaining[0].cells[0].id);
  };

  const exportAll = async () => {
    const nonEmptyPages = pages.filter((page) => page.cells.some((cell) => cell.photoId));
    if (!nonEmptyPages.length) { setError("请先把至少一张照片放入相纸"); return; }
    setExporting(true);
    setExportProgress(0);
    setError("");
    try {
      const generated: ExportFile[] = [];
      for (let index = 0; index < nonEmptyPages.length; index += 1) {
        const blob = await renderPage(nonEmptyPages[index], photos);
        const name = `photo-collage-${String(index + 1).padStart(2, "0")}.jpg`;
        generated.push({ name, blob, url: URL.createObjectURL(blob) });
        setExportProgress(Math.round(((index + 1) / nonEmptyPages.length) * 100));
        if ((index + 1) % 10 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      setExportFiles(generated);
      if (generated.length > 1) {
        const blob = await makeZip(generated);
        const packed = { name: "photo-collage.zip", blob, url: URL.createObjectURL(blob) };
        setZipFile(packed);
        downloadBlob(blob, packed.name);
      } else {
        setZipFile(null);
        downloadBlob(generated[0].blob, generated[0].name);
      }
      setView("complete");
    } catch {
      setError("导出失败，请减少页面数量后重试");
    } finally {
      setExporting(false);
    }
  };

  const restart = () => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.src));
    exportFiles.forEach((file) => URL.revokeObjectURL(file.url));
    if (zipFile) URL.revokeObjectURL(zipFile.url);
    setPhotos([]); setPages([]); setExportFiles([]); setZipFile(null); setView("upload"); setError("");
  };

  if (view === "upload") return <UploadView photos={photos} onFiles={addFiles} onStart={startEditing} loading={loadingPhotos} error={error}/>;
  if (view === "complete") return <CompleteView files={exportFiles} zipFile={zipFile} onContinue={() => setView("edit")} onRestart={restart}/>;

  return (
    <main className="app-shell" onClick={() => setSelectedCellId(null)}>
      <header className="topbar" onClick={(event) => event.stopPropagation()}>
        <div className="brand"><span className="brand-mark"><Icon name="image" size={19}/></span><span>相片拼贴</span></div>
        <div className="top-actions">
          <label className="gap-control"><span>留白</span><input aria-label="留白毫米" type="range" min="0.3" max="2" step="0.1" value={activePage?.gapMm ?? DEFAULT_GAP} onChange={(e) => setGap(Number(e.target.value))}/><strong>{(activePage?.gapMm ?? DEFAULT_GAP).toFixed(1)} mm</strong></label>
          <div className="dpi-badge"><span/>300 DPI</div>
          <button className="primary export-button" onClick={exportAll} disabled={exporting}>{exporting ? `正在导出 ${exportProgress}%` : <><Icon name="download"/> 批量导出</>}</button>
        </div>
      </header>

      <aside className="sidebar" onClick={(event) => event.stopPropagation()}>
        <input ref={editInput} hidden type="file" accept="image/jpeg,image/png" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => addFiles(Array.from(event.target.files ?? []))}/>
        <button className="secondary add-photo" onClick={() => editInput.current?.click()}><Icon name="upload"/> 添加照片</button>
        <section className="side-section">
          <div className="section-label"><span>版式</span><small>{activePage?.layout === "2-up" ? "2 张" : "4 张"}</small></div>
          <div className="layout-options">
            <button className={activePage?.layout === "2-up" ? "active" : ""} onClick={() => setLayout("2-up")}>
              <span className="layout-sketch two"><i/><i/></span><span><strong>2 张</strong><small>上下两行</small></span>
            </button>
            <button className={activePage?.layout === "4-up" ? "active" : ""} onClick={() => setLayout("4-up")}>
              <span className="layout-sketch four"><i/><i/><i/><i/></span><span><strong>4 张</strong><small>2 × 2 网格</small></span>
            </button>
          </div>
        </section>
        <section className="side-section photo-pool-section">
          <div className="section-label"><span>照片</span><small>{assigned.size} / {photos.length}</small></div>
          <div className="photo-pool">
            {photos.map((photo, index) => (
              <button
                key={photo.id}
                className={`pool-photo ${assigned.has(photo.id) ? "assigned" : ""}`}
                draggable
                onDragStart={(event) => event.dataTransfer.setData("photoId", photo.id)}
                onClick={() => quickAssign(photo.id)}
                title={assigned.has(photo.id) ? "已放入相纸；点击可替换当前格" : "点击放入当前格"}
              >
                <img src={photo.src} alt={photo.name}/><span>{String(index + 1).padStart(2, "0")}</span>{assigned.has(photo.id) && <b><Icon name="check" size={11}/></b>}
              </button>
            ))}
          </div>
        </section>
        <div className="privacy-note"><span className="privacy-dot"/><p><strong>本机处理</strong><br/>照片不会上传到服务器</p></div>
      </aside>

      <section className="workspace" onClick={() => setSelectedCellId(null)}>
        <div className="workspace-heading">
          <div><span>相纸预览</span><small>100 × 148 mm · 第 {Math.max(1, pages.findIndex((page) => page.id === activePage?.id) + 1)} / {pages.length} 页</small></div>
          <div className="page-tools">
            <button onClick={(event) => { event.stopPropagation(); addPage(); }}><Icon name="plus" size={15}/> 新增一页</button>
            {pages.length > 1 && <button className="danger-text" onClick={(event) => { event.stopPropagation(); removePage(); }}>删除本页</button>}
          </div>
        </div>

        {activePage && (
          <div className="paper-stage">
            <div
              className={`paper-preview ${activePage.layout === "4-up" ? "four-up" : "two-up"}`}
              style={activePage.layout === "2-up"
                ? { rowGap: `${(activePage.gapMm / 148) * 100}%` }
                : {
                    columnGap: `${activePage.gapMm}%`,
                    rowGap: `${(activePage.gapMm / 148) * 100}%`,
                  }}
              onClick={(event) => event.stopPropagation()}
            >
              {activePage.cells.map((cell) => (
                <PhotoCell
                  key={cell.id}
                  cell={cell}
                  photo={photos.find((photo) => photo.id === cell.photoId)}
                  selected={selectedCellId === cell.id}
                  onSelect={() => setSelectedCellId(cell.id)}
                  onUpdate={(transform) => updateCell(cell.id, (current) => ({ ...current, transform }))}
                  onRotate={() => updateCell(cell.id, (current) => ({ ...current, autoRotated: false, transform: { ...current.transform, rotation: ((current.transform.rotation + 90) % 360) as Transform["rotation"], offsetX: 0, offsetY: 0 } }))}
                  onReset={() => updateCell(cell.id, (current) => ({ ...current, transform: { ...current.transform, scale: 1, offsetX: 0, offsetY: 0 } }))}
                  onDropPhoto={(photoId, sourceCellId) => assignPhoto(cell.id, photoId, sourceCellId)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="canvas-footer">
          <div className="hint"><span>拖拽移动</span><i/> <span>双指缩放</span><i/> <span>双击重置</span></div>
          <div className="zoom-control">
            <button aria-label="缩小" disabled={!selectedCell?.photoId} onClick={(event) => { event.stopPropagation(); if (selectedCell) updateCell(selectedCell.id, (cell) => ({ ...cell, transform: { ...cell.transform, scale: Math.max(1, cell.transform.scale - 0.1) } })); }}><Icon name="minus" size={15}/></button>
            <span>{selectedCell ? Math.round(selectedCell.transform.scale * 100) : 100}%</span>
            <button aria-label="放大" disabled={!selectedCell?.photoId} onClick={(event) => { event.stopPropagation(); if (selectedCell) updateCell(selectedCell.id, (cell) => ({ ...cell, transform: { ...cell.transform, scale: Math.min(4, cell.transform.scale + 0.1) } })); }}><Icon name="plus" size={15}/></button>
          </div>
        </div>
        {pages.length > 1 && (
          <div className="page-strip" onClick={(event) => event.stopPropagation()}>
            {pages.map((page, index) => <button key={page.id} className={page.id === activePage.id ? "active" : ""} onClick={() => { setActivePageId(page.id); setSelectedCellId(page.cells[0].id); }}><span>{index + 1}</span>{page.layout === "2-up" ? "双行" : "四宫格"}</button>)}
          </div>
        )}
        {error && <div className="editor-error"><Icon name="close" size={15}/>{error}</div>}
      </section>
      {exporting && <div className="export-overlay"><div className="export-dialog"><div className="spinner"/><strong>正在生成高清相片</strong><span>{exportProgress}% · 请不要关闭页面</span><div className="progress-track"><i style={{ width: `${exportProgress}%` }}/></div></div></div>}
    </main>
  );
}
