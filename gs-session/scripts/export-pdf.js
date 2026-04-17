#!/usr/bin/env node

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.resolve(ROOT, 'dist/GS_52g_AI시대_일하는방식의재설계.pdf');
const PORT = 9877;

// 1. 빌드
console.log('🔨 빌드...');
execFileSync('node', ['scripts/build.js'], { cwd: ROOT, stdio: 'inherit' });

// 2. 임시 서버
const server = http.createServer((req, res) => {
  let fp = path.join(ROOT, req.url === '/' ? 'dist/lecture.html' : req.url.replace(/^\//, ''));
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(fp).toLowerCase();
  const mt = {'.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.css':'text/css','.js':'application/javascript'};
  res.writeHead(200, {'Content-Type': mt[ext] || 'application/octet-stream'});
  fs.createReadStream(fp).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log('\n🌐 서버: http://localhost:' + PORT);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto('http://localhost:' + PORT, { waitUntil: 'networkidle' });

  // 슬라이드 수 확인
  const count = await page.evaluate(() => document.querySelectorAll('.slide').length);
  console.log('📊 슬라이드 ' + count + '장\n');

  // 각 슬라이드 스크린샷
  const shots = [];
  for (let i = 0; i < count; i++) {
    await page.evaluate((idx) => {
      const slides = document.querySelectorAll('.slide');
      slides.forEach((s, j) => {
        s.classList.remove('active');
        s.style.opacity = j === idx ? '1' : '0';
        s.style.pointerEvents = j === idx ? 'auto' : 'none';
        s.style.zIndex = j === idx ? '10' : '0';
      });
      slides[idx].classList.add('active');
      // UI 숨기기
      document.querySelectorAll('#editorToggle, [data-editor="true"], .notes-panel, .counter, .progress, .hint, .notes-hint').forEach(el => el.style.display = 'none');
    }, i);

    await page.waitForTimeout(500);
    const buf = await page.screenshot({ type: 'png' });
    shots.push(buf);
    process.stdout.write('\r   📸 ' + (i + 1) + '/' + count);
  }

  console.log('\n\n📄 PDF 조합 중...');

  // 새 페이지에서 스크린샷들을 PDF로
  const pdfPage = await browser.newPage();
  const imgTags = shots.map(buf => {
    const b64 = buf.toString('base64');
    return '<div style="width:297mm;height:167mm;page-break-after:always;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;"><img src="data:image/png;base64,' + b64 + '" style="width:100%;height:100%;object-fit:contain;"></div>';
  }).join('');

  await pdfPage.setContent('<!DOCTYPE html><html><head><style>*{margin:0;padding:0;}@page{size:297mm 167mm;margin:0;}body{margin:0;}</style></head><body>' + imgTags + '</body></html>', { waitUntil: 'load' });

  await pdfPage.pdf({
    path: OUTPUT,
    width: '297mm',
    height: '167mm',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });

  await browser.close();
  server.close();

  const sizeMB = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
  console.log('\n✅ PDF 생성 완료!');
  console.log('   📁 ' + OUTPUT);
  console.log('   📊 ' + count + '장 · ' + sizeMB + 'MB');
})();
