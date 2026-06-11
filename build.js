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
const ENCRYPTED_DATA_FILE = path.join(DATA_DIR, 'data.js');

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

  // 写入加密数据到 data/data.js
  const dataJsContent = `window.ENCRYPTED_DATA = '${encrypted}';`;
  fs.writeFileSync(ENCRYPTED_DATA_FILE, dataJsContent, 'utf8');
  console.log(`✅ 已生成 ${ENCRYPTED_DATA_FILE}`);
  console.log(`🔐 访问密码: ${password}`);
}

build().catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});
