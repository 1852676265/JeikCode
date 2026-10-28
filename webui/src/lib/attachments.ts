import type { ImageData } from '../api';

/** Max attached images per message and per-image byte cap (raw file size). */
export const MAX_IMAGES = 6;
export const MAX_IMAGE_MB = 8;
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;

/** Supported multimodal image MIME types (Anthropic, OpenAI, Gemini compatible). */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const ACCEPTED_IMAGE_INPUT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/*';

export const MAX_IMAGE_DIMENSION = 2560;
export const MAX_PANORAMA_DIMENSION = 4096;
/** 有损编码质量。JPEG 无法控制色度抽样，文字截图仍优先走无损 PNG。 */
export const JPEG_QUALITY = 0.92;
export const WEBP_QUALITY = 0.95;

/** 原图直传预算：无需缩放、格式标准且体积不超过该值时，一字节不改地发给模型。 */
export const PASSTHROUGH_IMAGE_BYTES = 2 * 1024 * 1024;
/** 无损 PNG 输出预算：截图/文字图在此预算内保持 PNG，超出才退化为有损编码。 */
export const PNG_BUDGET_BYTES = 3.5 * 1024 * 1024;

export type PendingImage = {
  id: string;
  kind: 'image';
  image: ImageData;
};

export type PendingFile = {
  id: string;
  kind: 'file';
  name: string;
  size: number;
  file: File;
};

export type PendingAttach = PendingImage | PendingFile;

export interface ImageDimensions {
  width: number;
  height: number;
}

/** 一次转码所需的一种输出格式（按优先级排列，见 {@link planImageEncoders}）。 */
export interface ImageEncoder {
  media_type: string;
  quality?: number;
  /** 该格式的体积预算，超出则尝试下一种格式或缩小尺寸。 */
  maxBytes: number;
}

export function normalizeMimeType(type: string): string {
  return type.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function guessImageMediaType(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
}

export function isImageFile(file: File): boolean {
  const type = normalizeMimeType(file.type);
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.name);
}

export function countPending(attach: PendingAttach[]): { images: number; files: number } {
  let images = 0;
  let files = 0;
  for (const item of attach) {
    if (item.kind === 'image') images += 1;
    else files += 1;
  }
  return { images, files };
}

/** Build the user-turn text: original prompt, then numbered attachment paths. */
export function formatUserMessageWithAttachments(text: string, paths: string[]): string {
  if (paths.length === 0) return text;
  const lines = paths.map((path, i) => `附件${i + 1}：${path}`);
  const body = text.trim();
  return body ? `${body}\n\n${lines.join('\n')}` : lines.join('\n');
}

/**
 * 计算严格等比例缩放后的尺寸（Strict Aspect Ratio Preservation）。
 * 绝不拉伸、挤压或裁切画面内容。长宽均采用同一缩放因子 scale。
 */
export function calculateScaleDimensions(
  width: number,
  height: number,
  maxDimension = MAX_IMAGE_DIMENSION,
  maxPanoramaDimension = MAX_PANORAMA_DIMENSION,
): ImageDimensions {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const maxSide = Math.max(width, height);
  const minSide = Math.min(width, height);
  const aspectRatio = minSide > 0 ? maxSide / minSide : 1;
  // 长宽比超过 2.5:1 的长截图自适应放宽上限至 4096px，确保代码和文字清晰
  const bound = aspectRatio >= 2.5 ? maxPanoramaDimension : maxDimension;
  const scale = Math.min(1, bound / maxSide);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 首选无损 PNG 的源：除照片外的所有来源（界面截图、UI 导出、BMP/TIFF 转码）。
 * JPEG 的 4:2:0 色度抽样会把文字糊成毛边，且对大面积纯色 UI 截图往往比 PNG 更大
 * （实测 988×670 界面截图：PNG 59KB → JPEG q0.9 78KB 且更糊）。
 * HEIC/HEIF 是相机原片（同为照片语义），按 JPEG 处理。
 */
export function prefersLosslessPng(sourceMime: string): boolean {
  const mime = normalizeMimeType(sourceMime);
  return mime !== 'image/jpeg' && mime !== 'image/heic' && mime !== 'image/heif';
}

/**
 * PNG 超出体积预算后的有损兜底顺序：
 * 1. 含透明通道绝不输出 JPEG —— Canvas 把透明像素合成为纯黑，截图圆角/图标会直接“坏图”，
 *    改走同样支持 alpha、且对文字远好于 JPEG 的 WebP（浏览器不支持时会自行回退为 PNG）；
 * 2. 照片源（JPEG）直接重编码 JPEG；3. 其余不透明图退 PNG→JPEG。
 */
export function planLossyEncoders(
  sourceMime: string,
  hasAlpha: boolean,
  budget = MAX_IMAGE_BYTES,
): ImageEncoder[] {
  if (hasAlpha) {
    return [
      { media_type: 'image/webp', quality: WEBP_QUALITY, maxBytes: budget },
      { media_type: 'image/png', maxBytes: MAX_IMAGE_BYTES },
    ];
  }
  if (normalizeMimeType(sourceMime) === 'image/jpeg') {
    return [
      { media_type: 'image/jpeg', quality: JPEG_QUALITY, maxBytes: budget },
      { media_type: 'image/webp', quality: WEBP_QUALITY, maxBytes: MAX_IMAGE_BYTES },
    ];
  }
  return [
    { media_type: 'image/jpeg', quality: JPEG_QUALITY, maxBytes: budget },
    { media_type: 'image/webp', quality: WEBP_QUALITY, maxBytes: MAX_IMAGE_BYTES },
  ];
}

/** 读取文件为原始 Base64 Data URL */
function readAsDataUrl(file: File | Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * 解析 Data URL。以浏览器**实际**返回的 MIME 为准（请求了 WebP/JPEG 却得到 PNG 时不能贴错标签），
 * 同时把 `canvas.toDataURL` 失败产生的 `data:,` 判为空，避免把空图当成图片上传。
 */
export function parseImageDataUrl(
  url: string,
  fallbackMime: string,
): { media_type: string; data: string; bytes: number } | null {
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const data = url.slice(comma + 1);
  if (!data) return null;
  const header = url.slice(5, comma); // 去掉 "data:"
  const mediaType = header.split(';')[0]?.trim().toLowerCase() || fallbackMime;
  // base64 体积估算需扣掉 `=` 填充，否则预算判断会偏大
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((data.length * 3) / 4) - padding;
  return { media_type: mediaType, data, bytes };
}

/**
 * 逐级折半缩小后再落到目标尺寸。
 * 一次性把 4000px 缩到 1200px 会让浏览器只取少数采样点，文字直接糊掉；逐级降采样可显著保住笔画。
 * 直接从原图开始取半，不会额外建一张与原图等大的中间画布（大图那会吃掉数十 MB 内存）。
 */
function downscaleToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
): HTMLCanvasElement | null {
  const draw = (
    src: CanvasImageSource,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
  ): HTMLCanvasElement | null => {
    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
    return canvas;
  };

  let src: CanvasImageSource = source;
  let curW = width;
  let curH = height;
  while (curW / 2 > outWidth && curH / 2 > outHeight) {
    const nextW = Math.max(outWidth, Math.floor(curW / 2));
    const nextH = Math.max(outHeight, Math.floor(curH / 2));
    const next = draw(src, curW, curH, nextW, nextH);
    if (!next) return null;
    src = next;
    curW = nextW;
    curH = nextH;
  }
  if (curW === outWidth && curH === outHeight && src instanceof HTMLCanvasElement) return src;
  return draw(src, curW, curH, outWidth, outHeight);
}

/** 扫描目标画布是否真的带透明像素；读不到像素时保守按“有透明通道”处理。 */
function canvasHasTransparency(canvas: HTMLCanvasElement): boolean {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** 相机原片（HEIC/HEIF）的 ISO-BMFF major brand；`mif1/msf1` 也覆盖 AVIF 容器。 */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/**
 * 嗅探 ISO-BMFF `ftyp` box，判断是否为 HEIF/HEIC 容器。
 * 必须按字节判定：部分 Android / 微信 webview 传上来的 HEIC 文件名和 MIME 都是空的。
 */
export async function looksLikeHeif(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head.length < 12) return false;
    const box = String.fromCharCode(head[4], head[5], head[6], head[7]);
    if (box !== 'ftyp') return false;
    const brand = String.fromCharCode(head[8], head[9], head[10], head[11]).toLowerCase();
    return HEIF_BRANDS.has(brand);
  } catch {
    return false;
  }
}

/** 载入 libheif wasm 解码器（约 2MB，仅遇到浏览器解不开的 HEIF 时才按需加载）。 */
async function loadHeifDecoder(): Promise<typeof import('libheif-js/wasm-bundle').HeifDecoder | null> {
  try {
    const mod = (await import('libheif-js/wasm-bundle')) as unknown as {
      HeifDecoder?: typeof import('libheif-js/wasm-bundle').HeifDecoder;
      default?: { HeifDecoder?: typeof import('libheif-js/wasm-bundle').HeifDecoder };
    };
    // CJS 产物在部分打包器下只挂到 default 上，两处都取
    return mod.HeifDecoder ?? mod.default?.HeifDecoder ?? null;
  } catch {
    return null;
  }
}

/**
 * 用 libheif wasm 把 HEIC/HEIF 解成画布。
 * 返回 null 表示解码器不可用或图片损坏 —— 调用方会退回到“明确提示用户”的路径，绝不发坏图。
 */
/**
 * libheif 解出的是全分辨率 RGBA，解码 + 白纸 + 旋转大约占像素数 ×12 字节。
 * 超过 50MP 的 HEIF（扫描件/拼接全景）在浏览器里很可能直接把标签页打挂，干脆不做。
 */
const MAX_HEIF_PIXELS = 50_000_000;

/**
 * 用 libheif wasm 把 HEIC/HEIF 解成画布。
 * 返回 null 表示解码器不可用、尺寸过大或图片损坏 —— 调用方会退回到“明确提示用户”的路径，绝不发坏图。
 * `hasAlpha` 顺带从已经解出的 RGBA 里读出，避免后续再扫一遍整画布。
 */
async function decodeHeifToCanvas(
  blob: Blob,
): Promise<{ canvas: HTMLCanvasElement; hasAlpha: boolean } | null> {
  if (typeof document === 'undefined') return null;
  const HeifDecoder = await loadHeifDecoder();
  if (!HeifDecoder) return null;
  let handles: Array<{ free?: () => void }> = [];
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const decoded = new HeifDecoder().decode(bytes);
    handles = decoded;
    const first = decoded[0];
    if (!first) return null;
    const width = first.get_width();
    const height = first.get_height();
    if (!width || !height) return null;
    if (width * height > MAX_HEIF_PIXELS) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const frame = ctx.createImageData(width, height);
    // 用 globalThis.ImageData：本模块内的 `ImageData` 是 api 里的 { media_type, data }，会遮蔽 DOM 同名类型
    const result = await new Promise<globalThis.ImageData | null>((resolve) => {
      first.display(frame, (value) => resolve(value ?? null));
    });
    if (!result) return null;
    let hasAlpha = false;
    const rgba = result.data;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] < 250) {
        hasAlpha = true;
        break;
      }
    }
    ctx.putImageData(result, 0, 0);
    return { canvas, hasAlpha };
  } catch {
    return null;
  } finally {
    // wasm 堆上的句柄必须显式释放，否则多张 HEIC 会持续持内存
    for (const handle of handles) {
      try {
        handle.free?.();
      } catch {
        /* 释放失败不影响已经解出的画面 */
      }
    }
  }
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  encoder: ImageEncoder,
): { media_type: string; data: string; bytes: number } | null {
  let url: string;
  try {
    url = canvas.toDataURL(encoder.media_type, encoder.quality);
  } catch {
    return null;
  }
  return parseImageDataUrl(url, encoder.media_type);
}

/**
 * 按格式优先级转码，全部超预算时缩小尺寸重试（最多两轮，每次 70%）。
 *
 * 顺序上先试无损 PNG，再探测透明通道决定有损兑底格式：
 * 这样绝大多数截图（PNG 在预算内）只编一次码，无需额外整幅像素扫描。
 * 入参是 `CanvasImageSource`：浏览器直出的 `<img>` 和 libheif 解出的画布共用同一条转码管线。
 */
interface TranscodeOptions {
  /** 已确定的透明通道结论（如 libheif 解码时顺带得出的），省掉一次整幅像素扫描。 */
  alphaHint?: boolean;
}

function transcodeToImageData(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  target: ImageDimensions,
  sourceMime: string,
  options: TranscodeOptions = {},
  attempt = 0,
): ImageData | null {
  const canvas = downscaleToCanvas(source, naturalWidth, naturalHeight, target.width, target.height);
  if (!canvas) return null;

  // 1) 截图/文字图：优先无损 PNG（天然保留 alpha，不会出现黑底）
  if (prefersLosslessPng(sourceMime)) {
    const png = encodeCanvas(canvas, { media_type: 'image/png', maxBytes: PNG_BUDGET_BYTES });
    if (png && png.bytes <= PNG_BUDGET_BYTES) {
      return { media_type: png.media_type, data: png.data };
    }
  }

  // 2) 有损兜底：先确认是否真的带透明通道，含 alpha 绝不交给 JPEG（JPEG 源不可能有 alpha）
  const hasAlpha = options.alphaHint
    ?? (normalizeMimeType(sourceMime) === 'image/jpeg' ? false : canvasHasTransparency(canvas));
  let smallest: { media_type: string; data: string; bytes: number } | null = null;
  for (const encoder of planLossyEncoders(sourceMime, hasAlpha)) {
    const encoded = encodeCanvas(canvas, encoder);
    if (!encoded) continue;
    if (!smallest || encoded.bytes < smallest.bytes) smallest = encoded;
    if (encoded.bytes <= encoder.maxBytes) {
      return { media_type: encoded.media_type, data: encoded.data };
    }
  }

  if (attempt < 2) {
    const retry = {
      width: Math.max(1, Math.round(target.width * 0.7)),
      height: Math.max(1, Math.round(target.height * 0.7)),
    };
    return transcodeToImageData(source, naturalWidth, naturalHeight, retry, sourceMime, options, attempt + 1);
  }

  return smallest && smallest.bytes <= MAX_IMAGE_BYTES
    ? { media_type: smallest.media_type, data: smallest.data }
    : null;
}

/**
 * 将 File 转换为大模型兼容的 ImageData。
 * 1. 拦截超过 MAX_IMAGE_BYTES (8MB) 的超大文件；
 * 2. 动图 GIF 优先保留原始动态帧；
 * 3. 对高分辨率手机长图/截图执行严格等比自适应缩放（锁定宽高比，杜绝画面拉伸/畸形）；
 * 4. 仅对照片走 JPEG；截图/文字图保持无损 PNG，含透明通道的图不会被合成为黑底；
 * 5. iOS HEIC/HEIF（含微信 webview 里 MIME 为空的）用 libheif wasm 现场解码后重新编码；
 *    仍解不开的格式直接丢弃，绝不错标 MIME 后当成正常图片发出去；
 * 6. 在缺少 DOM 环境（如 Node.js 单元测试）下提供安全回退。
 */
export async function fileToImageData(file: File): Promise<ImageData | null> {
  if (file.size > MAX_IMAGE_BYTES) {
    return null;
  }
  // MIME 与扩展名都可能缺失（webview / 剪贴板给的 blob），此时只能按字节确认是不是 HEIF
  if (!isImageFile(file) && !(await looksLikeHeif(file))) {
    return null;
  }

  const normalizedType = normalizeMimeType(file.type);
  const guessedType = guessImageMediaType(file.name);
  const rawMime = normalizedType && normalizedType.startsWith('image/') ? normalizedType : guessedType;

  // GIF 动图不通过 Canvas 重绘（避免丢帧变成静态图），直接保留原始数据
  if (rawMime === 'image/gif') {
    const dataUrl = await readAsDataUrl(file);
    if (!dataUrl) return null;
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? { media_type: 'image/gif', data: dataUrl.slice(comma + 1) } : null;
  }

  // 缺少 DOM / Canvas 环境时的无头安全回退（如 Node.js 测试环境）
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    const dataUrl = await readAsDataUrl(file);
    if (!dataUrl) return null;
    const comma = dataUrl.indexOf(',');
    const mediaType = (rawMime && ACCEPTED_IMAGE_TYPES.includes(rawMime as typeof ACCEPTED_IMAGE_TYPES[number]))
      ? rawMime
      : 'image/jpeg';
    return comma >= 0 ? { media_type: mediaType, data: dataUrl.slice(comma + 1) } : null;
  }

  // 浏览器环境：加载图片并进行尺寸与兼容性分析
  return new Promise<ImageData | null>((resolve) => {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      const naturalWidth = img.naturalWidth || img.width;
      const naturalHeight = img.naturalHeight || img.height;

      if (!naturalWidth || !naturalHeight) {
        resolve(null);
        return;
      }

      const targetDim = calculateScaleDimensions(naturalWidth, naturalHeight);
      const scaleNoop = targetDim.width === naturalWidth && targetDim.height === naturalHeight;
      const isStandardMime = !!rawMime && ACCEPTED_IMAGE_TYPES.includes(rawMime as typeof ACCEPTED_IMAGE_TYPES[number]);

      // 若分辨率无需缩放、格式已经是标准大模型格式、且大小在预算内，直接复用原图 Base64，100% 原始画质
      if (scaleNoop && isStandardMime && file.size <= PASSTHROUGH_IMAGE_BYTES) {
        void (async () => {
          const rawDataUrl = await readAsDataUrl(file);
          const parsed = rawDataUrl ? parseImageDataUrl(rawDataUrl, rawMime as string) : null;
          resolve(parsed ? { media_type: rawMime as string, data: parsed.data } : null);
        })();
        return;
      }

      // 需要等比缩放或转码（如手机高分辨率大图、超预算图片、或 iOS 的 HEIC 格式）
      try {
        resolve(transcodeToImageData(img, naturalWidth, naturalHeight, targetDim, rawMime ?? ''));
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      void (async () => {
        // 浏览器解不开时，先试 HEIC/HEIF：iPhone 原片在桌面 Chrome 上不走这条就只有“坏图”
        // 或“上传不了”两个结局。wasm 解码器按需加载，不影响普通图片的链路速度。
        if (await looksLikeHeif(file)) {
          const heif = await decodeHeifToCanvas(file);
          if (heif) {
            const { canvas, hasAlpha } = heif;
            const heifTarget = calculateScaleDimensions(canvas.width, canvas.height);
            resolve(
              transcodeToImageData(canvas, canvas.width, canvas.height, heifTarget, 'image/heic', {
                alphaHint: hasAlpha,
              }),
            );
            return;
          }
        }
        // 其余解不开的格式（TIFF/BMP 变种等）不能贴上 image/jpeg 标签原样上传：
        // provider 收到“声称 JPEG 的原始字节”只会得到坏图。只有 MIME 本身被模型原生支持时
        // 才允许原字节直传，其余一律丢弃（调用方改为明确提示用户，而不是渲染一张裂图）。
        if (!rawMime || !ACCEPTED_IMAGE_TYPES.includes(rawMime as typeof ACCEPTED_IMAGE_TYPES[number])) {
          resolve(null);
          return;
        }
        const rawDataUrl = await readAsDataUrl(file);
        const parsed = rawDataUrl ? parseImageDataUrl(rawDataUrl, rawMime) : null;
        resolve(parsed ? { media_type: rawMime, data: parsed.data } : null);
      })();
    };

    img.src = blobUrl;
  });
}
