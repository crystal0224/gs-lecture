#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const slidesDir = path.join(__dirname, "../slides");
const templateDir = path.join(slidesDir, "_template");
const distDir = path.join(__dirname, "../dist");
const outputFile = path.join(distDir, "lecture.html");

console.log("🔨 Building lecture.html...\n");

// 템플릿 읽기
console.log("📖 Reading templates...");
const header = fs.readFileSync(path.join(templateDir, "header.html"), "utf8");
const footer = fs.readFileSync(path.join(templateDir, "footer.html"), "utf8");

// 슬라이드 파일 수집 (파일명 순서대로 정렬)
console.log("🔍 Collecting slide files...");
const slideFiles = fs
  .readdirSync(slidesDir)
  .filter((f) => f.startsWith("slide-") && f.endsWith(".html"))
  .sort(); // 파일명 기준 정렬

console.log(`   Found ${slideFiles.length} slides\n`);

// 슬라이드 내용 읽기
const slides = slideFiles.map((filename, index) => {
  const filepath = path.join(slidesDir, filename);
  let content = fs.readFileSync(filepath, "utf8");

  // 첫 번째 슬라이드에만 active 클래스 추가
  if (index === 0) {
    content = content.replace(/class="slide /, 'class="slide active ');
  }

  console.log(`   ✅ ${filename}`);
  return content;
});

// 통합
console.log("\n🔗 Combining files...");
const output = header + "\n" + slides.join("\n\n") + "\n" + footer;

// 출력 디렉토리 생성
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 기존 파일 자동 백업 (덮어쓰기 전)
if (fs.existsSync(outputFile)) {
  const stats = fs.statSync(outputFile);
  const timestamp = new Date(stats.mtime)
    .toISOString()
    .replace(/:/g, "-")
    .split(".")[0];
  const backupFile = path.join(distDir, `backup-${timestamp}.html`);
  fs.copyFileSync(outputFile, backupFile);
  console.log(`\n💾 Backup created: backup-${timestamp}.html`);

  // 백업 파일 최대 3개 유지
  const backups = fs
    .readdirSync(distDir)
    .filter((f) => f.startsWith("backup-") && f.endsWith(".html"))
    .sort();
  while (backups.length > 3) {
    const oldest = backups.shift();
    fs.unlinkSync(path.join(distDir, oldest));
    console.log(`   Old backup removed: ${oldest}`);
  }
}

fs.writeFileSync(outputFile, output, "utf8");

console.log(`\n✨ Built successfully!`);
console.log(`   Output: ${outputFile}`);
console.log(`   Size: ${(output.length / 1024).toFixed(1)} KB`);
console.log(`   Slides: ${slideFiles.length}`);
