import assert from 'assert';
import ConversationManager from '../conversationManager';

function run(): void {
  console.log('\n🧪 Running Inline Buttons Tests...\n');

  const cm = new ConversationManager();

  const rawResponse = [
    'Выберите действие:',
    '[BUTTONS]',
    '[[{"text":"Каталог","callback_data":"catalog"}],[{"text":"Менеджер","url":"https://t.me/example_manager"}]]',
    '[NOTIFY_ADMIN]Нажали меню',
  ].join('\n');

  const parsed = cm.parseNotificationCommands(rawResponse);
  assert.strictEqual(parsed.chatMessage, 'Выберите действие:');
  assert.strictEqual(parsed.adminNotification, 'Нажали меню');
  assert.strictEqual(parsed.userNotification, null);
  assert.deepStrictEqual(parsed.inlineKeyboard, [
    [{ text: 'Каталог', callback_data: 'catalog' }],
    [{ text: 'Менеджер', url: 'https://t.me/example_manager' }],
  ]);

  const objectFormat = [
    'Выберите вариант:',
    '[BUTTONS]',
    '{"inline_keyboard":[[{"text":"FAQ","callback_data":"faq"}]]}',
  ].join('\n');
  const parsedObject = cm.parseNotificationCommands(objectFormat);
  assert.strictEqual(parsedObject.chatMessage, 'Выберите вариант:');
  assert.deepStrictEqual(parsedObject.inlineKeyboard, [[{ text: 'FAQ', callback_data: 'faq' }]]);

  const invalidFormat = [
    'Сделайте выбор:',
    '[BUTTONS]',
    'это не JSON',
  ].join('\n');
  const parsedInvalid = cm.parseNotificationCommands(invalidFormat);
  assert.strictEqual(parsedInvalid.chatMessage, 'Сделайте выбор:');
  assert.strictEqual(parsedInvalid.inlineKeyboard, null);

  console.log('✅ Inline buttons parser tests passed\n');
}

run();
