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
const FACE_GROUP_REPORT_FILE = path.join(DATA_DIR, 'face-group-report.json');
const MERGED_DATA_FILE = path.join(DATA_DIR, 'data.json');
const ENCRYPTED_DATA_FILE = path.join(DATA_DIR, 'data.js');
const DESKMATE_DIR = path.join(DATA_DIR, '同桌照');
const GROUP_DIR = path.join(DATA_DIR, '小组照');

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

// 从子目录名解析出索引
// 对于同桌照：子目录名如 "01_彭曦怡_钟皖闽"，提取 "01" 作为索引
// 对于小组照：子目录名如 "第一组"，需要与 groups.json 中的条目匹配
function getPartnerIndex(subdirName, partnerList) {
  // 从子目录名提取数字前缀，如 "01_彭曦怡_钟皖闽" -> "01"
  const match = subdirName.match(/^(\d+)_/);
  if (!match) return null;

  const numStr = match[1];
  // 在 partnerList 中查找对应的条目
  for (let i = 0; i < partnerList.length; i++) {
    const entry = partnerList[i];
    // partnerList 格式如 "01: 彭曦怡, 钟皖闽"
    if (entry.startsWith(numStr + ':')) {
      return i;
    }
  }
  return null;
}

function getGroupIndex(subdirName, groupList) {
  // 直接与 groupList 中的条目匹配
  // groupList 格式如 "第一组: 聂子墨, ..."
  for (let i = 0; i < groupList.length; i++) {
    const entry = groupList[i];
    if (entry.startsWith(subdirName + ':')) {
      return i;
    }
  }
  return null;
}

// 遍历目录，构建 BelongTo 映射
function buildBelongToMap(dirPath, jsonFile, albumType, isPartner) {
  const belongToMap = {};

  // 检查目录是否存在
  if (!fs.existsSync(dirPath)) {
    console.log(`📁 目录 ${dirPath} 不存在，跳过`);
    return belongToMap;
  }

  // 读取 partners.json 或 groups.json
  let listData;
  try {
    listData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  } catch (err) {
    console.error(`❌ 无法读取 ${jsonFile}:`, err.message);
    return belongToMap;
  }

  const list = isPartner ? listData.PartnerList : listData.GroupList;

  // 遍历子目录
  const subdirs = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  if (subdirs.length === 0) {
    console.log(`📁 目录 ${dirPath} 没有子目录，跳过`);
    return belongToMap;
  }

  // 读取 response.json
  let responseJson;
  try {
    responseJson = JSON.parse(fs.readFileSync(RESPONSE_FILE, 'utf8'));
  } catch (err) {
    console.error(`❌ 无法读取 ${RESPONSE_FILE}:`, err.message);
    return belongToMap;
  }

  // 构建 PhotoName -> OrderAlbumID 的映射
  const photoNameToId = new Map();
  for (const item of responseJson.ajaxDataTable) {
    if (item.AlbumType === String(albumType)) {
      // 从 DownPhotoPic 提取文件名
      const url = item.DownPhotoPic;
      const fileName = path.basename(url);
      photoNameToId.set(fileName, item.OrderAlbumID);
    }
  }

  // 遍历每个子目录
  for (const subdir of subdirs) {
    // 获取索引
    let index;
    if (isPartner) {
      index = getPartnerIndex(subdir, list);
    } else {
      index = getGroupIndex(subdir, list);
    }

    if (index === null) {
      console.log(`⚠️  子目录 ${subdir} 在 ${isPartner ? 'partners.json' : 'groups.json'} 中找不到对应条目，跳过`);
      continue;
    }

    // 遍历子目录中的文件
    const subdirPath = path.join(dirPath, subdir);
    const files = fs.readdirSync(subdirPath);

    for (const file of files) {
      // 检查文件是否在 response.json 中
      const orderAlbumId = photoNameToId.get(file);
      if (orderAlbumId) {
        belongToMap[orderAlbumId] = index;
      }
    }
  }

  return belongToMap;
}

// 从 face_group.py 生成的报告中构建 文件名 -> SceneId 的映射
function buildSceneMap() {
  const sceneMap = {};
  if (!fs.existsSync(FACE_GROUP_REPORT_FILE)) {
    console.log(`📁 未找到 ${FACE_GROUP_REPORT_FILE}，跳过 SceneId（请先运行 npm run face-group）`);
    return sceneMap;
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(FACE_GROUP_REPORT_FILE, 'utf8'));
  } catch (err) {
    console.error(`❌ 无法读取 ${FACE_GROUP_REPORT_FILE}:`, err.message);
    return sceneMap;
  }
  for (const key of ['partner', 'group']) {
    for (const item of report[key] || []) {
      if (item && item.scene_id && item.image) {
        // item.image 是移动前的原始路径，basename 与 response.json 中的文件名一致
        sceneMap[path.basename(item.image)] = item.scene_id;
      }
    }
  }
  return sceneMap;
}

// 从 response.json 提取 AlbumType 为 "2" 或 "4" 的图片数据，并添加 BelongTo
function step4_transformImages() {
  console.log('📝 提取图片数据...');
  let responseJson;
  try {
    responseJson = JSON.parse(fs.readFileSync(RESPONSE_FILE, 'utf8'));
  } catch (err) {
    console.error(`❌ 无法读取 ${RESPONSE_FILE}:`, err.message);
    process.exit(1);
  }

  // 构建 BelongTo 映射
  console.log('📝 构建 BelongTo 映射...');
  const partnerBelongTo = buildBelongToMap(DESKMATE_DIR, PARTNERS_FILE, 4, true);
  const groupBelongTo = buildBelongToMap(GROUP_DIR, GROUPS_FILE, 2, false);

  // 合并映射（注意：键是字符串）
  const belongToMap = { ...partnerBelongTo, ...groupBelongTo };
  console.log(`📝 BelongTo 映射构建完成，目录中共 ${Object.keys(belongToMap).length} 张照片`);

  // 构建 SceneId 映射（按文件名）
  console.log('📝 构建 SceneId 映射...');
  const sceneMap = buildSceneMap();
  console.log(`📝 SceneId 映射构建完成，共 ${Object.keys(sceneMap).length} 张照片有场景信息`);

  // 提取 AlbumType 为 "2" 或 "4" 的数据，并添加 BelongTo
  // 注意：需要将 OrderAlbumID 转换为字符串来查询 belongToMap
  // 使用 ?? 而不是 ||，因为 0 是有效的 BelongTo 值
  const albumList = responseJson.ajaxDataTable
    .filter(item => item.AlbumType === '2' || item.AlbumType === '4')
    .map(item => {
      const belongTo = belongToMap[String(item.OrderAlbumID)];
      const sceneId = sceneMap[path.basename(item.DownPhotoPic)];
      return {
        OrderAlbumID: item.OrderAlbumID,
        DownPhotoPic: item.DownPhotoPic,
        SmallPath: item.SmallPath,
        AlbumType: item.AlbumType,
        BelongTo: belongTo !== undefined ? belongTo : null,
        SceneId: sceneId !== undefined ? sceneId : null
      };
    });

  // 统计成功映射的数量
  const mappedCount = albumList.filter(item => item.BelongTo !== null).length;
  console.log(`✅ BelongTo 映射: ${mappedCount}/${albumList.length} 张照片`);

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
