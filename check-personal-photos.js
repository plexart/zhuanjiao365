#!/usr/bin/env node
/**
 * 检查个人照选择情况
 * AlbumType 为 3 表示个人照，Remark 是人员姓名，State 为 2 表示选中图片
 *
 * 规则：
 * - 学生（照片>=7张）：需选2张
 * - 老师（照片<7张）：需选1张
 */

const fs = require('fs');
const path = require('path');

// 中文全角空格，用于对齐
const FULL_SPACE = '　';
const MAX_NAME_LEN = 4;

// 判断是否为老师（照片少于7张）
const isTeacher = (total) => total < 7;

// 获取应选数量
const getRequired = (total) => isTeacher(total) ? 1 : 2;

// 格式化名字，使用全角空格对齐
function formatName(name) {
  const pad = MAX_NAME_LEN - name.length;
  return name + FULL_SPACE.repeat(pad);
}

// 读取数据源
const dataPath = path.join(__dirname, 'data', 'response.json');
const rawData = fs.readFileSync(dataPath, 'utf8');
const data = JSON.parse(rawData);

// 统计每个人员的选中照片数量
const personalPhotos = data.ajaxDataTable.filter(item => item.AlbumType === '3');

const personStats = {};
personalPhotos.forEach(photo => {
  const name = photo.Remark || '未命名';
  if (!personStats[name]) {
    personStats[name] = { selected: 0, total: 0 };
  }
  personStats[name].total++;
  if (photo.State === '2') {
    personStats[name].selected++;
  }
});

// 分离学生和老师
const students = {};
const teachers = {};

Object.entries(personStats).forEach(([name, stats]) => {
  if (isTeacher(stats.total)) {
    teachers[name] = stats;
  } else {
    students[name] = stats;
  }
});

// 分类学生
const notEnough = [];
const tooMany = [];
const exactly = [];

Object.entries(students).forEach(([name, stats]) => {
  const required = getRequired(stats.total);
  if (stats.selected < required) {
    notEnough.push({ name, selected: stats.selected, total: stats.total, required });
  } else if (stats.selected > required) {
    tooMany.push({ name, selected: stats.selected, total: stats.total, required });
  } else {
    exactly.push({ name, selected: stats.selected, total: stats.total, required });
  }
});

// 分类老师
const teacherNotEnough = [];
const teacherTooMany = [];
const teacherExactly = [];

Object.entries(teachers).forEach(([name, stats]) => {
  const required = getRequired(stats.total);
  if (stats.selected < required) {
    teacherNotEnough.push({ name, selected: stats.selected, total: stats.total, required });
  } else if (stats.selected > required) {
    teacherTooMany.push({ name, selected: stats.selected, total: stats.total, required });
  } else {
    teacherExactly.push({ name, selected: stats.selected, total: stats.total, required });
  }
});

// 按选中数量排序
notEnough.sort((a, b) => b.selected - a.selected);
tooMany.sort((a, b) => a.selected - b.selected);
exactly.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

teacherNotEnough.sort((a, b) => b.selected - a.selected);
teacherTooMany.sort((a, b) => a.selected - b.selected);
teacherExactly.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

// 输出结果
console.log('\n📊 个人照选择情况统计（学生）\n');
console.log('======================');

// 第一部分：未选够的学生
if (notEnough.length > 0) {
  console.log('\n🔴 未选够2张的学生 (' + notEnough.length + '人):');
  console.log('----------------------');
  notEnough.forEach(p => {
    const missing = p.required - p.selected;
    console.log(`${formatName(p.name)}：${p.selected}/${p.required}`);
  });
}

// 第二部分：超过2张的学生
if (tooMany.length > 0) {
  console.log('\n🟡 超过2张的学生 (' + tooMany.length + '人):');
  console.log('----------------------');
  tooMany.forEach(p => {
    const extra = p.selected - p.required;
    console.log(`${formatName(p.name)}：${p.selected}/${p.required}`);
  });
}

// 第三部分：刚好选2张的学生
if (exactly.length > 0) {
  console.log('\n🟢 刚好选2张的学生 (' + exactly.length + '人):');
  console.log('----------------------');
  exactly.forEach(p => {
    console.log(`${formatName(p.name)}：${p.selected}/${p.required}`);
  });
}

// 汇总学生
const totalStudents = Object.keys(students).length;
const completedStudents = exactly.length;
console.log('\n======================');
console.log(`📈 学生总计: ${completedStudents}/${totalStudents}  (${totalStudents > 0 ? Math.round(completedStudents / totalStudents * 100) : 0}%)`);

// 输出老师统计
const hasTeacherData = teacherNotEnough.length > 0 || teacherTooMany.length > 0 || teacherExactly.length > 0;

if (hasTeacherData) {
  console.log('\n\n📊 老师选择情况\n');
  console.log('======================');
}

if (teacherNotEnough.length > 0) {
  console.log('\n🔴 未选够1张的老师 (' + teacherNotEnough.length + '人):');
  console.log('----------------------');
  teacherNotEnough.forEach(p => {
    console.log(`${formatName(p.name)}：${p.selected}/${p.required}`);
  });
}

if (teacherTooMany.length > 0) {
  console.log('\n🟡 超过1张的老师 (' + teacherTooMany.length + '人):');
  console.log('----------------------');
  teacherTooMany.forEach(p => {
    console.log(`${formatName(p.name)}：${p.selected}/${p.required}`);
  });
}

if (teacherExactly.length > 0) {
  console.log('\n🟢 刚好选1张的老师 (' + teacherExactly.length + '人):');
  console.log('----------------------');
  teacherExactly.forEach(p => {
    console.log(`${formatName(p.name)}：${p.selected}/${p.required}`);
  });
}

const totalTeachers = Object.keys(teachers).length;
const completedTeachers = teacherExactly.length;

if (hasTeacherData) {
  console.log('\n======================');
  console.log(`📈 老师总计: ${completedTeachers}/${totalTeachers}  (${totalTeachers > 0 ? Math.round(completedTeachers / totalTeachers * 100) : 0}%)`);
}

// 全体总计
const totalPeople = totalStudents + totalTeachers;
const totalCompleted = completedStudents + completedTeachers;
console.log('\n======================');
console.log(`📈 全体总计: ${totalCompleted}/${totalPeople}  (${totalPeople > 0 ? Math.round(totalCompleted / totalPeople * 100) : 0}%)`);

console.log('');
