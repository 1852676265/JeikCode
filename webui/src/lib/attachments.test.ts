import { test } from 'node:test';
import assert from 'node:assert';
import {
  formatUserMessageWithAttachments,
  isImageFile,
  countPending,
  calculateScaleDimensions,
  normalizeMimeType,
  prefersLosslessPng,
  planLossyEncoders,
  parseImageDataUrl,
  looksLikeHeif,
  MAX_IMAGE_MB,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_PANORAMA_DIMENSION,
} from './attachments.ts';

test('formatUserMessageWithAttachments appends numbered absolute paths', () => {
  assert.equal(
    formatUserMessageWithAttachments('请看这个', ['E:/proj/.jeikcode_store/a.pdf', 'E:/proj/.jeikcode_store/b.txt']),
    '请看这个\n\n附件1：E:/proj/.jeikcode_store/a.pdf\n附件2：E:/proj/.jeikcode_store/b.txt',
  );
});

test('formatUserMessageWithAttachments works with empty prompt', () => {
  assert.equal(
    formatUserMessageWithAttachments('  ', ['D:/store/a.csv']),
    '附件1：D:/store/a.csv',
  );
});

test('formatUserMessageWithAttachments is a no-op without paths', () => {
  assert.equal(formatUserMessageWithAttachments('hello', []), 'hello');
});

test('isImageFile uses mime type, parameters, and common extensions (including HEIC)', () => {
  assert.equal(isImageFile(new File(['x'], 'a.png', { type: 'image/png' })), true);
  assert.equal(isImageFile(new File(['x'], 'a.png', { type: 'image/png; charset=utf-8' })), true);
  assert.equal(isImageFile(new File(['x'], 'photo.jpg', { type: '' })), true);
  assert.equal(isImageFile(new File(['x'], 'shot.heic', { type: 'image/heic' })), true);
  assert.equal(isImageFile(new File(['x'], 'raw.heif', { type: '' })), true);
  assert.equal(isImageFile(new File(['x'], 'notes.pdf', { type: 'application/pdf' })), false);
  assert.equal(isImageFile(new File(['x'], 'notes.txt', { type: '' })), false);
});

test('normalizeMimeType strips parameters and lowercase', () => {
  assert.equal(normalizeMimeType('image/png; charset=utf-8'), 'image/png');
  assert.equal(normalizeMimeType('IMAGE/JPEG '), 'image/jpeg');
  assert.equal(normalizeMimeType(''), '');
});

test('MAX_IMAGE_MB is upgraded to 8MB', () => {
  assert.equal(MAX_IMAGE_MB, 8);
});

test('calculateScaleDimensions preserves strict aspect ratio without distortion', () => {
  // 1. 普通小图无需缩放
  const small = calculateScaleDimensions(1200, 800);
  assert.deepEqual(small, { width: 1200, height: 800 });

  // 2. 手机常见 19.5:9 竖屏截图 (如 iPhone 14/15/16 Pro: 1290 x 2796)
  const phone = calculateScaleDimensions(1290, 2796);
  assert.equal(phone.height, MAX_IMAGE_DIMENSION); // 2560
  // 验证纵横比一致性 (容差小于 0.001)
  const origRatio = 1290 / 2796;
  const scaledRatio = phone.width / phone.height;
  assert.ok(Math.abs(origRatio - scaledRatio) < 0.001, `Ratio mismatch: ${origRatio} vs ${scaledRatio}`);

  // 3. 超长网页滚屏截图 (如 1080 x 8000, 纵横比 > 2.5:1) 放宽至 MAX_PANORAMA_DIMENSION (4096)
  const longScroll = calculateScaleDimensions(1080, 8000);
  assert.equal(longScroll.height, MAX_PANORAMA_DIMENSION);
  const origLongRatio = 1080 / 8000;
  const scaledLongRatio = longScroll.width / longScroll.height;
  assert.ok(Math.abs(origLongRatio - scaledLongRatio) < 0.001, `Ratio mismatch: ${origLongRatio} vs ${scaledLongRatio}`);
});

test('planLossyEncoders never sends alpha images through JPEG (black-background corruption)', () => {
  const encoders = planLossyEncoders('image/png', true);
  assert.equal(encoders[0].media_type, 'image/webp');
  assert.ok(encoders.every((e) => e.media_type !== 'image/jpeg'));
});

test('planLossyEncoders keeps photos on JPEG and never mislabels budgets', () => {
  // 照片类 JPEG：重编码 JPEG 才是有损压缩的适用场景
  assert.equal(planLossyEncoders('image/jpeg', false)[0].media_type, 'image/jpeg');
  // 不透明的 PNG 截图超预算时才退化到 JPEG
  assert.equal(planLossyEncoders('image/png', false)[0].media_type, 'image/jpeg');
  // 每种格式的预算都不超过单图上限，避免转码结果撑爆请求
  for (const mime of ['image/png', 'image/jpeg', '']) {
    for (const alpha of [true, false]) {
      for (const encoder of planLossyEncoders(mime, alpha)) {
        assert.ok(encoder.maxBytes <= MAX_IMAGE_BYTES);
      }
    }
  }
});

test('prefersLosslessPng only skips photos (JPEG/HEIC/HEIF)', () => {
  // 截图/UI/BMP 转码全部优先无损 PNG —— JPEG 的色度抽样会糊字，且对纯色截图反而更大
  assert.equal(prefersLosslessPng('image/png'), true);
  assert.equal(prefersLosslessPng('image/webp'), true);
  assert.equal(prefersLosslessPng(''), true);
  // 相机原片按照片语义走有损 JPEG
  assert.equal(prefersLosslessPng('image/jpeg'), false);
  assert.equal(prefersLosslessPng('image/heic'), false);
  assert.equal(prefersLosslessPng('image/heif'), false);
});

test('looksLikeHeif sniffs the ISO-BMFF ftyp brand instead of trusting the file name', async () => {
  const box = (brand: string) => {
    const head = [0, 0, 0, 24, 102, 116, 121, 112, ...brand.split('').map((c) => c.charCodeAt(0))];
    return new Blob([new Uint8Array(head)]);
  };
  // iPhone / Android 原片：文件名和 MIME 可能都是空的，只能看字节
  assert.equal(await looksLikeHeif(box('heic')), true);
  assert.equal(await looksLikeHeif(box('mif1')), true);
  assert.equal(await looksLikeHeif(box('hevc')), true);
  // PNG / JPEG 的头部不是 ftyp
  assert.equal(await looksLikeHeif(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13])])), false);
  assert.equal(await looksLikeHeif(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])])), false);
  assert.equal(await looksLikeHeif(new Blob([new Uint8Array([0, 0, 0])])), false);
});

test('parseImageDataUrl trusts the encoder mime and rejects empty payloads', () => {
  const png = parseImageDataUrl('data:image/png;base64,QQ==', 'image/jpeg');
  assert.deepEqual(png, { media_type: 'image/png', data: 'QQ==', bytes: 1 });
  // 请求 WebP 但浏览器回落成 PNG 时必须按真实格式标注，否则 provider 收到错标签
  assert.equal(parseImageDataUrl('data:image/png;base64,QQ==', 'image/webp')?.media_type, 'image/png');
  // toDataURL 失败会返回 `data:,`，绝不能被当成一张可用的图片
  assert.equal(parseImageDataUrl('data:,', 'image/png'), null);
  assert.equal(parseImageDataUrl('', 'image/png'), null);
});

test('countPending splits images and files', () => {
  const counts = countPending([
    { id: '1', kind: 'image', image: { media_type: 'image/png', data: 'QQ==' } },
    { id: '2', kind: 'file', name: 'a.pdf', size: 12, file: new File(['x'], 'a.pdf') },
    { id: '3', kind: 'file', name: 'b.txt', size: 4, file: new File(['y'], 'b.txt') },
  ]);
  assert.deepEqual(counts, { images: 1, files: 2 });
});
