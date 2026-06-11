const fs = require('fs');
const path = require('path');

const DATA_DIR = './data';
const RESPONSE_FILE = path.join(DATA_DIR, 'response.json');

// AlbumType 对应的目录名
const ALBUM_TYPE_DIRS = {
  '0': '校园风景',
  '1': '集体造型照',
  '2': '小组照',
  '3': '个人照',
  '4': '同桌照',
};

/**
 * 读取 response.json
 */
function loadResponseData() {
  try {
    const data = fs.readFileSync(RESPONSE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`❌ 无法读取 ${RESPONSE_FILE}:`, err.message);
    console.error('请先运行 npm run download 下载 response.json');
    process.exit(1);
  }
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 从 URL 中提取文件名
 */
function getFileNameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    return path.basename(pathname);
  } catch {
    // 如果 URL 解析失败，尝试从字符串中提取
    const parts = url.split('/');
    return parts[parts.length - 1];
  }
}

/**
 * 下载单个文件
 */
async function downloadFile(url, destPath) {
  // 检查文件是否已存在
  if (fs.existsSync(destPath)) {
    return { downloaded: false, exists: true };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { downloaded: false, exists: false, error: response.status };
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(buffer));

    return { downloaded: true, exists: false };
  } catch (err) {
    return { downloaded: false, exists: false, error: err.message };
  }
}

/**
 * 下载进度显示
 */
class ProgressTracker {
  constructor(total) {
    this.total = total;
    this.downloaded = 0;
    this.skipped = 0;
    this.failed = 0;
  }

  update(result) {
    if (result.downloaded) {
      this.downloaded++;
    } else if (result.exists) {
      this.skipped++;
    } else {
      this.failed++;
    }
    this.print();
  }

  print() {
    const completed = this.downloaded + this.skipped + this.failed;
    const percent = Math.floor((completed / this.total) * 100);
    process.stdout.write(
      `\r进度: ${completed}/${this.total} (${percent}%) | 下载: ${this.downloaded} | 跳过: ${this.skipped} | 失败: ${this.failed}`,
    );
  }

  finish() {
    console.log(); // 换行
  }
}

/**
 * 下载图片
 */
async function downloadImages() {
  console.log('📝 加载数据...');
  const responseData = loadResponseData();

  if (!responseData.ajaxDataTable || !Array.isArray(responseData.ajaxDataTable)) {
    console.error('❌ response.json 格式错误');
    process.exit(1);
  }

  const photos = responseData.ajaxDataTable;
  console.log(`\n找到 ${photos.length} 张图片`);

  // 按类型分组
  const byType = {};
  for (const photo of photos) {
    const albumType = photo.AlbumType;
    if (!byType[albumType]) {
      byType[albumType] = [];
    }
    byType[albumType].push(photo);
  }

  // 统计
  console.log('\n分类统计:');
  for (const [type, typePhotos] of Object.entries(byType)) {
    const dirName = ALBUM_TYPE_DIRS[type] || `类型${type}`;
    console.log(`  ${dirName}: ${typePhotos.length} 张`);
  }

  // 确认
  console.log('\n开始下载...\n');

  const tracker = new ProgressTracker(photos.length);
  const errors = [];

  for (const photo of photos) {
    const albumType = photo.AlbumType;
    const photoUrl = photo.DownPhotoPic;
    const remark = photo.Remark;

    if (!photoUrl) {
      tracker.update({ downloaded: false, exists: false, error: 'No URL' });
      continue;
    }

    // 确定目标目录
    const baseDir = ALBUM_TYPE_DIRS[albumType] || `类型${albumType}`;
    let targetDir = path.join(DATA_DIR, baseDir);

    // AlbumType 为 3 且有 Remark 时，创建子目录
    if (albumType === '3' && remark && remark.trim() !== '') {
      const subDirName = remark.trim();
      targetDir = path.join(targetDir, subDirName);
    }

    ensureDir(targetDir);

    // 获取文件名
    const fileName = getFileNameFromUrl(photoUrl);
    const destPath = path.join(targetDir, fileName);

    // 下载
    const result = await downloadFile(photoUrl, destPath);

    if (!result.downloaded && !result.exists && result.error) {
      errors.push({ url: photoUrl, error: result.error });
    }

    tracker.update(result);
  }

  tracker.finish();

  // 显示结果
  console.log('\n✅ 下载完成');
  console.log(`  新下载: ${tracker.downloaded} 张`);
  console.log(`  已存在: ${tracker.skipped} 张`);
  console.log(`  失败: ${tracker.failed} 张`);

  if (errors.length > 0) {
    console.log('\n❌ 下载失败的图片:');
    for (const err of errors.slice(0, 10)) {
      console.log(`  ${err.url}`);
      console.log(`    错误: ${err.error}`);
    }
    if (errors.length > 10) {
      console.log(`  ... 还有 ${errors.length - 10} 个失败`);
    }
  }
}

downloadImages().catch((err) => {
  console.error('下载失败:', err);
  process.exit(1);
});
