const CryptoJS = require('crypto-js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 配置文件路径
const DATA_DIR = './data';
const RESPONSE_FILE = path.join(DATA_DIR, 'response.json');
const PARTNERS_FILE = path.join(DATA_DIR, 'partners.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const IMAGES_FILE = path.join(DATA_DIR, 'images.json');
const MERGED_DATA_FILE = path.join(DATA_DIR, 'data.json');
const TEMPLATE_FILE = './template.html';
const OUTPUT_FILE = './dist/index.html';

// 模板中的占位符（必须与 HTML 中一致）
const PLACEHOLDER = 'ENCRYPTED_DATA_PLACEHOLDER';

async function getPassword() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question('请输入加密密码: ', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// 从 response.json 提取 AlbumType 为 "2" 或 "4" 的图片数据
function step4_transformImages() {
  console.log('📝 提取图片数据...');
  let responseJson;
  try {
    responseJson = JSON.parse(fs.readFileSync(RESPONSE_FILE, 'utf8'));
  } catch (err) {
    console.error(`❌ 无法读取 ${RESPONSE_FILE}:`, err.message);
    process.exit(1);
  }

  // 提取 AlbumType 为 "2" 或 "4" 的数据
  const albumList = responseJson.ajaxDataTable
    .filter(item => item.AlbumType === '2' || item.AlbumType === '4')
    .map(item => ({
      OrderAlbumID: item.OrderAlbumID,
      DownPhotoPic: item.DownPhotoPic,
      SmallPath: item.SmallPath,
      AlbumType: item.AlbumType
    }));

  const imagesData = { AlbumList: albumList };

  // 确保 data 目录存在
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(IMAGES_FILE, JSON.stringify(imagesData, null, 2), 'utf8');
  console.log(`✅ 已生成 ${IMAGES_FILE} (${albumList.length} 张图片)`);
  return imagesData;
}

// 合并 partners.json、groups.json 和 images.json
function step5_mergeFiles(imagesData) {
  console.log('📝 合并数据文件...');

  let partnersData, groupsData;
  try {
    partnersData = JSON.parse(fs.readFileSync(PARTNERS_FILE, 'utf8'));
  } catch (err) {
    console.error(`❌ 无法读取 ${PARTNERS_FILE}:`, err.message);
    process.exit(1);
  }

  try {
    groupsData = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
  } catch (err) {
    console.error(`❌ 无法读取 ${GROUPS_FILE}:`, err.message);
    process.exit(1);
  }

  const mergedData = {
    PartnerList: partnersData.PartnerList,
    GroupList: groupsData.GroupList,
    AlbumList: imagesData.AlbumList
  };

  fs.writeFileSync(MERGED_DATA_FILE, JSON.stringify(mergedData, null, 2), 'utf8');
  console.log(`✅ 已生成 ${MERGED_DATA_FILE}`);
  return mergedData;
}

async function build() {
  // 检查必要的输入文件是否存在
  const missingFiles = [];
  if (!fs.existsSync(RESPONSE_FILE)) missingFiles.push('data/response.json');
  if (!fs.existsSync(PARTNERS_FILE)) missingFiles.push('data/partners.json');
  if (!fs.existsSync(GROUPS_FILE)) missingFiles.push('data/groups.json');

  if (missingFiles.length > 0) {
    console.error('❌ 缺少以下输入文件:');
    missingFiles.forEach(f => console.error(`   - ${f}`));
    console.error('\n请参考 README.md 准备数据文件。');
    process.exit(1);
  }

  // 执行步骤4和5
  const imagesData = step4_transformImages();
  const jsonData = step5_mergeFiles(imagesData);

  // 获取密码
  const password = await getPassword();
  if (!password) {
    console.error('❌ 密码不能为空');
    process.exit(1);
  }

  // 加密
  const plainText = JSON.stringify(jsonData);
  const encrypted = CryptoJS.AES.encrypt(plainText, password).toString();
  console.log('✅ 数据加密成功');

  // 读取 HTML 模板
  let template;
  try {
    template = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  } catch (err) {
    console.error(`❌ 无法读取模板 ${TEMPLATE_FILE}:`, err.message);
    process.exit(1);
  }

  // 替换占位符
  if (!template.includes(PLACEHOLDER)) {
    console.error(`❌ 模板中未找到占位符 "${PLACEHOLDER}"`);
    process.exit(1);
  }
  const finalHtml = template.replace(PLACEHOLDER, encrypted);

  // 确保输出目录存在
  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 写入最终 HTML
  fs.writeFileSync(OUTPUT_FILE, finalHtml, 'utf8');
  console.log(`🎉 生成成功！文件已保存至: ${OUTPUT_FILE}`);
  console.log(`🔐 访问密码: ${password}`);
}

build().catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});
