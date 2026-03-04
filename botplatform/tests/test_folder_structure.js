#!/usr/bin/env node
/**
 * Тест проверки структуры папок botplatform
 * Проверяет что пользовательские папки и шаблоны продуктов на месте
 */

const fs = require('fs');
const path = require('path');

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  RESET: '\x1b[0m'
};

function log(message, color = COLORS.RESET) {
  console.log(`${color}${message}${COLORS.RESET}`);
}

function testFolderStructure() {
  let passed = 0;
  let failed = 0;

  log('\n🧪 Тест структуры папок botplatform\n', COLORS.YELLOW);

  // Test 1: Проверка что group_data существует в botplatform
  log('Test 1: Проверка /root/aisell/botplatform/group_data/');
  const groupDataPath = '/root/aisell/botplatform/group_data';
  if (fs.existsSync(groupDataPath)) {
    log('  ✅ Директория group_data/ существует', COLORS.GREEN);
    passed++;

    const userFolders = fs.readdirSync(groupDataPath)
      .filter(f => f.startsWith('user_') && fs.statSync(path.join(groupDataPath, f)).isDirectory());
    log(`  ✅ Найдено ${userFolders.length} пользовательских папок`, COLORS.GREEN);
    passed++;
  } else {
    log('  ❌ Директория group_data/ НЕ существует', COLORS.RED);
    failed++;
  }

  // Test 2: Проверка что noxonbot group_data существует
  log('\nTest 2: Проверка /root/aisell/noxonbot/group_data/');
  const noxonGroupData = '/root/aisell/noxonbot/group_data';
  if (fs.existsSync(noxonGroupData)) {
    log('  ✅ Директория noxonbot/group_data/ существует', COLORS.GREEN);
    passed++;

    const groupFolders = fs.readdirSync(noxonGroupData)
      .filter(f => f.startsWith('-') && fs.statSync(path.join(noxonGroupData, f)).isDirectory());
    log(`  ✅ Найдено ${groupFolders.length} групповых папок`, COLORS.GREEN);
    passed++;
  } else {
    log('  ❌ Директория noxonbot/group_data/ НЕ существует', COLORS.RED);
    failed++;
  }

  // Test 3: Проверка что в /root/ нет старых папок user_*
  log('\nTest 3: Проверка отсутствия старых папок в /root/');
  const rootFolders = fs.readdirSync('/root')
    .filter(f => {
      const fullPath = path.join('/root', f);
      return fs.statSync(fullPath).isDirectory() &&
             (f.startsWith('user_') || /^-\d+$/.test(f));
    });

  if (rootFolders.length === 0) {
    log('  ✅ В /root/ нет старых папок user_* или групповых', COLORS.GREEN);
    passed++;
  } else {
    log(`  ❌ В /root/ найдены старые папки: ${rootFolders.join(', ')}`, COLORS.RED);
    failed++;
  }

  // Test 4: Проверка CLAUDE.md у существующих пользователей
  log('\nTest 4: Проверка CLAUDE.md файлов у пользователей');
  if (fs.existsSync(groupDataPath)) {
    const userFolders = fs.readdirSync(groupDataPath)
      .filter(f => f.startsWith('user_') && fs.statSync(path.join(groupDataPath, f)).isDirectory());

    let claudeMdFound = 0;
    userFolders.forEach(folder => {
      const claudeMdPath = path.join(groupDataPath, folder, 'CLAUDE.md');
      if (fs.existsSync(claudeMdPath)) {
        claudeMdFound++;
      }
    });

    if (userFolders.length === 0) {
      log('  ⚠️  Нет пользовательских папок для проверки', COLORS.YELLOW);
      passed++;
    } else if (claudeMdFound > 0) {
      log(`  ✅ CLAUDE.md найден для ${claudeMdFound}/${userFolders.length} пользователей`, COLORS.GREEN);
      passed++;
    } else {
      log(`  ⚠️  CLAUDE.md не найден ни у одного из ${userFolders.length} пользователей`, COLORS.YELLOW);
      passed++; // Warning, not failure — new users may not have CLAUDE.md yet
    }
  } else {
    log('  ⚠️  group_data/ не существует, пропускаем', COLORS.YELLOW);
    passed++;
  }

  // Test 5: Проверка product templates
  log('\nTest 5: Проверка SKILL.md для продуктов');
  const productsDir = '/root/aisell/products';
  const expectedProducts = ['simple_dashboard', 'simple_site'];
  let templatesFound = 0;

  expectedProducts.forEach(product => {
    const templatePath = path.join(productsDir, product, 'SKILL.md');
    if (fs.existsSync(templatePath)) {
      const content = fs.readFileSync(templatePath, 'utf8');
      if (content.includes('Безопасность')) {
        log(`  ✅ ${product}/SKILL.md — валидный шаблон`, COLORS.GREEN);
        templatesFound++;
      } else {
        log(`  ❌ ${product}/SKILL.md — отсутствуют обязательные секции`, COLORS.RED);
        failed++;
      }
    } else {
      log(`  ❌ ${product}/SKILL.md НЕ найден`, COLORS.RED);
      failed++;
    }

    // Negative check: old CLAUDE.md.template must NOT exist (renamed to SKILL.md)
    const oldTemplatePath = path.join(productsDir, product, 'CLAUDE.md.template');
    if (!fs.existsSync(oldTemplatePath)) {
      log(`  ✅ ${product}/CLAUDE.md.template — отсутствует (переименован в SKILL.md)`, COLORS.GREEN);
      passed++;
    } else {
      log(`  ❌ ${product}/CLAUDE.md.template — всё ещё существует (должен быть удалён)`, COLORS.RED);
      failed++;
    }
  });

  if (templatesFound === expectedProducts.length) {
    log(`  ✅ Все ${templatesFound} product templates валидны`, COLORS.GREEN);
    passed++;
  }

  // Итоги
  log('\n' + '='.repeat(60));
  log(`Результаты тестирования:`, COLORS.YELLOW);
  log(`✅ Пройдено: ${passed}`, COLORS.GREEN);
  if (failed > 0) {
    log(`❌ Провалено: ${failed}`, COLORS.RED);
  }
  log(`📊 Успешность: ${Math.round(passed / (passed + failed) * 100)}%`);
  log('='.repeat(60) + '\n');

  return failed === 0;
}

// Запуск теста
const success = testFolderStructure();
process.exit(success ? 0 : 1);
