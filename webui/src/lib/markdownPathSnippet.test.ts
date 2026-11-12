import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isFilePathSnippet,
  isLikelyDirPath,
  isSystemDefaultAppFile,
  computeFileContextMenuPosition,
} from './markdownPathSnippet.ts';

test('isSystemDefaultAppFile detects executable, archive, image and office files', () => {
  // 可执行文件
  assert.equal(isSystemDefaultAppFile('app.exe'), true);
  assert.equal(isSystemDefaultAppFile('setup.MSI'), true);
  assert.equal(isSystemDefaultAppFile('./dist/bin.exe'), true);
  assert.equal(isSystemDefaultAppFile('C:/tools/launch.exe'), true);

  // 压缩包
  assert.equal(isSystemDefaultAppFile('archive.zip'), true);
  assert.equal(isSystemDefaultAppFile('backup.rar'), true);
  assert.equal(isSystemDefaultAppFile('./pkg.7z'), true);
  assert.equal(isSystemDefaultAppFile('/tmp/bundle.tar.gz'), true);

  // 镜像文件
  assert.equal(isSystemDefaultAppFile('ubuntu.iso'), true);
  assert.equal(isSystemDefaultAppFile('disk.img'), true);
  assert.equal(isSystemDefaultAppFile('D:\\iso\\win11.iso'), true);

  // 常用办公文档与演示文档
  assert.equal(isSystemDefaultAppFile('report.doc'), true);
  assert.equal(isSystemDefaultAppFile('contract.docx'), true);
  assert.equal(isSystemDefaultAppFile('presentation.ppt'), true);
  assert.equal(isSystemDefaultAppFile('slides.pptx'), true);
  assert.equal(isSystemDefaultAppFile('data.xls'), true);
  assert.equal(isSystemDefaultAppFile('budget.xlsx'), true);
  assert.equal(isSystemDefaultAppFile('document.pdf'), true);

  // 源码和代码文件不是系统默认应用文件，由编辑器预览
  assert.equal(isSystemDefaultAppFile('index.ts'), false);
  assert.equal(isSystemDefaultAppFile('main.rs'), false);
  assert.equal(isSystemDefaultAppFile('README.md'), false);
});

test('isFilePathSnippet recognizes relative and absolute paths with target extensions', () => {
  // 相对路径与单文件名
  assert.equal(isFilePathSnippet('setup.exe'), true);
  assert.equal(isFilePathSnippet('./output.zip'), true);
  assert.equal(isFilePathSnippet('../backup.rar'), true);
  assert.equal(isFilePathSnippet('dist/installer.exe'), true);
  assert.equal(isFilePathSnippet('images/system.iso'), true);
  assert.equal(isFilePathSnippet('specs/design.docx'), true);
  assert.equal(isFilePathSnippet('finance/q4.xlsx'), true);

  // 绝对路径
  assert.equal(isFilePathSnippet('C:/Windows/System32/cmd.exe'), true);
  assert.equal(isFilePathSnippet('D:\\Download\\update.zip'), true);
  assert.equal(isFilePathSnippet('/var/iso/install.iso'), true);

  // 命令行被过滤，不被当成文件路径
  assert.equal(isFilePathSnippet('git status'), false);
  assert.equal(isFilePathSnippet('npm run build'), false);
  assert.equal(isFilePathSnippet('cargo test --lib'), false);
});

test('isLikelyDirPath correctly differentiates directories and files', () => {
  // 文件绝不被当做目录
  assert.equal(isLikelyDirPath('setup.exe'), false);
  assert.equal(isLikelyDirPath('dist/app.exe'), false);
  assert.equal(isLikelyDirPath('./data/backup.zip'), false);
  assert.equal(isLikelyDirPath('C:/images/disk.iso'), false);
  assert.equal(isLikelyDirPath('docs/plan.docx'), false);
  assert.equal(isLikelyDirPath('src/main.rs'), false);

  // 真正带斜杠或目录结构的路径识别为目录
  assert.equal(isLikelyDirPath('src/'), true);
  assert.equal(isLikelyDirPath('webui/src/components'), true);
  assert.equal(isLikelyDirPath('C:\\'), true);
  assert.equal(isLikelyDirPath('./dist/'), true);
});

test('computeFileContextMenuPosition scales properly with page zoom and prevents drifting', () => {
  // 1.0x 正常缩放
  const normal = computeFileContextMenuPosition(500, 300, 1.0, false, 1920, 1080);
  assert.equal(normal.x, 500);
  assert.equal(normal.y, 300);

  // 1.5x 放大模式：坐标需除以 zoom=1.5，以使 portal 在 zoom=1.5 的 body 中精准对齐鼠标点击点
  const zoomIn = computeFileContextMenuPosition(600, 450, 1.5, false, 1920, 1080);
  assert.equal(zoomIn.x, 400); // 600 / 1.5 = 400
  assert.equal(zoomIn.y, 300); // 450 / 1.5 = 300

  // 0.75x 缩小模式：坐标需除以 zoom=0.75
  const zoomOut = computeFileContextMenuPosition(600, 450, 0.75, false, 1920, 1080);
  assert.equal(zoomOut.x, 800); // 600 / 0.75 = 800
  assert.equal(zoomOut.y, 600); // 450 / 0.75 = 600

  // 视口边界反转保护（靠近右下边缘时向左上方弹出）
  const edge = computeFileContextMenuPosition(1900, 1060, 1.0, false, 1920, 1080);
  assert.ok(edge.x < 1900, 'Menu x should flip away from right boundary');
  assert.ok(edge.y < 1060, 'Menu y should flip away from bottom boundary');
});
