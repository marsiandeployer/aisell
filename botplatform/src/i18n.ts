/**
 * i18n Translation System
 * CHANGE: Created bilingual support system
 * WHY: User request "noxonbot сделай двуязычным (но только чтоб текста были рядом, чтоб ии сразу понял что надо переводить два текста)"
 * REF: User message
 */

export type Language = 'ru' | 'en';

export interface TranslationStrings {
  // Start command messages
  'start.group': string;
  'start.no_onboarding': string;
  'start.onboarding_begin': string;
  'start.with_config': string;
  'start.crm': string;
  'start.simple_site': string;
  'start.simple_dashboard': string;
  'start.simple_bounty': string;

  // Help command
  'help.title': string;
  'help.commands_header': string;
  'help.start_command': string;
  'help.help_command': string;
  'help.cancel_command': string;
  'help.restart_command': string;
  'help.getchatid_command': string;
  'help.new_command': string;
  'help.ko_command': string;
  'help.kl_command': string;
  'help.shortcuts': string;
  'help.ko_shortcut': string;
  'help.kl_shortcut': string;
  'help.private_default_note': string;
  'help.group_privacy_note': string;

  // Group welcome
  'group.welcome': string;
  'group.main_command': string;
  'group.ko_description': string;
  'group.execution_time': string;

  // Errors
  'error.chat_not_found': string;
  'error.file_upload_failed': string;
  'error.no_active_tasks': string;
  'error.directory_not_exists': string;
  'error.reload_failed': string;
  'error.onboarding_required': string;
  'error.prompt_required': string;
  'error.timeout': string;
  'error.execution_failed': string;
  'error.internal': string;
  'error.working_dir_not_configured': string;
  'error.project_not_found': string;
  'error.cli_auth_required': string;
  'error.cli_no_output_failure': string;
  'error.cli_not_installed': string;
  'error.sensitive_data_blocked': string;

  // Chat info
  'chatinfo.id': string;
  'chatinfo.type': string;
  'chatinfo.title': string;
  'chatinfo.username': string;

  // Conversation
  'conversation.reset': string;

  // Files
  'file.uploaded': string;

  // Cancel
  'cancel.summary': string;
  'cancel.avg_elapsed': string;

  // Restart
  'restart.no_directory': string;
  'restart.success_private': string;
  'restart.success_group': string;

  // Messages
  'message.continuation': string;

  // Hints
  'hint.try_codex': string;

  // Onboarding steps
  'onboarding.idea_saved': string;
  'onboarding.server.has_server': string;
  'onboarding.server.no_server': string;
  'onboarding.bot.create_bot': string;
  'onboarding.bot.token_request': string;
  'onboarding.payment.subscription_options': string;
  'onboarding.payment.own_keys': string;
  'onboarding.payment.our_keys': string;
  'onboarding.payment.success': string;
  'onboarding.ssh.request': string;
  'onboarding.completion': string;
  'onboarding.bot_token_valid': string;
  'onboarding.setup_starting': string;

  // Task execution
  'task.starting': string;
  'task.running': string;
  'task.completed': string;
  'task.cancelled': string;
  'task.failed': string;
  'task.success_no_output': string;
  'task.codex_no_output_retry': string;

  // Buttons
  'button.server_yes': string;
  'button.server_no': string;
  'button.keys_own': string;
  'button.keys_ours': string;
  'button.server_abroad': string;
  'button.server_rf': string;
  'button.cancel_task': string;
  'button.pay_stars': string;
  'button.pay_external': string;
  'button.free_demo': string;

  // Payment
  'payment.premium_choice': string;
  'payment.stars_invoice_title': string;
  'payment.stars_invoice_description': string;
  'payment.success': string;

  // Activation
  'activation.success': string;
  'activation.free_success': string;
  'activation.ready': string;

  // Status messages
  'status.launching': string;
  'status.prompt': string;
  'status.history': string;
  'status.codex_slow_note': string;
  'status.output_tail': string;
  'status.running': string;
  'status.elapsed': string;

  // CLAUDE.md file content
  'claudemd.title': string;
  'claudemd.idea_section': string;
  'claudemd.no_description': string;
  'claudemd.instructions': string;
}

const translations: Record<Language, TranslationStrings> = {
  ru: {
    // Start command messages
    'start.group': '👋 Привет! Я помогу вам создать AI-бота или веб-приложение.\n\n🧩 В группах используйте команды:\n• /кл <ваш запрос> — Claude\n• /ко <ваш запрос> — Codex\n\n🗣️ В личном чате можно просто писать (например, "Привет") — по умолчанию запустится Claude.\n\n💡 Если Claude ответил "You\'ve hit your limit", попробуйте Codex: начните с "ко " (или /ко в группе).\n\n🕒 Codex ("ко") может отвечать очень долго (10+ минут) — это нормально.\n\n⏱️ Выполнение может занять несколько минут, я буду присылать обновления статуса.',
    'start.no_onboarding': '👋 Привет! Добро пожаловать в @clodeboxbot!\n\n🆓 Вы используете бесплатную версию с общим workspace.\n\n🗣️ В личном чате можно просто писать (например, "Привет") — по умолчанию запустится Claude.\n\n💡 Если Claude ответил "You\'ve hit your limit", попробуйте Codex: начните с "ко " (или /ко в группе).\n\n🕒 Codex ("ко") может отвечать очень долго (10+ минут) — это нормально.\n\n⏱️ Выполнение может занять несколько минут, я буду присылать обновления статуса.\n\n⭐ Хотите личный workspace? Напишите @noxonbot для premium подписки.',
    'start.onboarding_begin': '👋 Привет! Я помогу вам создать AI-бота или веб-приложение.\n\n💡 Расскажите простыми словами, что вы хотите создать?\n\n📝 Примеры:\n• Лендинг-пейдж по моей презентации\n• Telegram-бот для записи к врачу\n• Веб-приложение для учёта финансов\n\n🌐 Важно: бесплатный домен (wpmix.net) в России может открываться только через VPN (из-за замедления трафика).',
    'start.with_config': '👋 Привет! Я готов.\n\n🗣️ В личном чате можно просто писать (например, "Привет") — по умолчанию запустится Claude.\n\n💡 Если Claude ответил "You\'ve hit your limit", попробуйте Codex: начните с "ко " (или /ко в группе).\n\n🕒 Codex ("ко") может отвечать очень долго (10+ минут) — это нормально.\n\n⏱️ Выполнение может занять несколько минут, я буду присылать обновления статуса.',
    // CHANGE: CRM welcome message for ?start=crm deep-link
    // WHY: User request "если передается в ?start параметре crm то велком месадж должен быть про crm"
    // REF: User message 2026-02-10
    'start.crm': '👋 Привет! Я помогу создать CRM-систему для вашего бизнеса.\n\n🎯 AI CRM Constructor - это CRM, которая подстраивается под ваши бизнес-процессы.\n\n✅ Без лишних функций - только то, что нужно именно вам\n✅ Быстрое внедрение - 1-2 недели\n✅ Полный контроль - исходный код принадлежит вам\n\n💡 Опишите мне ваш бизнес и процессы, и я помогу создать идеальную CRM:\n\n📝 Расскажите:\n• Чем занимается ваш бизнес?\n• Какие основные этапы работы с клиентом?\n• Что нужно учитывать (клиенты, заказы, проекты)?\n• Какие интеграции нужны (Telegram, email, платежи)?',
    'start.simple_site': '🌐 Привет! Я SimpleSite - ваш AI-помощник для создания лендингов и сайтов.\n\n💡 Просто опишите, что вам нужно:\n• "Лендинг салона красоты с формой записи"\n• "Меню ресторана с ценами"\n• "Портфолио фотографа с формой обратной связи"\n\n🎨 Я создам красивую страницу с:\n• Современным адаптивным дизайном\n• AI-генерированными фоновыми изображениями\n• Формами заявки/контактов\n• Мгновенным превью\n\n✨ Какой сайт вы хотите создать?',
    'start.simple_dashboard': '📊 Привет! Я SimpleDashboard - ваш AI-помощник для создания бизнес-дашбордов.\n\n📁 Загрузите ваши данные:\n• Excel файл (.xlsx, .xls)\n• CSV файл\n• Ссылка на Google Sheets\n\n💡 Или опишите, какой дашборд вам нужен:\n• "Дашборд продаж с графиком выручки по месяцам"\n• "Маркетинговая аналитика с воронкой конверсий"\n• "Учёт склада с оповещениями о низких остатках"\n\n📈 Я создам профессиональные дашборды с:\n• Интерактивными графиками (линейные, столбчатые, круговые)\n• KPI-карточками с трендами\n• Таблицами данных с фильтрами\n\n📚 Примеры и промпты: {showcases_link}\n\n✨ Какую аналитику вы хотите видеть?',
    'start.simple_bounty': '🎯 Привет! Я SimpleBounty - ваш AI-помощник для создания bounty-кампаний.\n\n💡 Расскажите, что нужно сделать:\n• Название кампании\n• Описание и цель\n• Задания с наградами в поинтах\n\n📋 Я помогу:\n• Создать кампанию с заданиями\n• Настроить награды за каждое задание\n• Пополнить эскроу поинтами\n• Опубликовать страницу для участников\n\n✨ Какую кампанию вы хотите создать?',

    // Help command
    'help.title': '🤖 Noxon Bot - Справка',
    'help.commands_header': '📝 Команды:',
    'help.start_command': '/start - Приветствие и информация',
    'help.help_command': '/help - Эта справка',
    'help.cancel_command': '/cancel - Отменить активную задачу',
    'help.restart_command': '/restart - Перезагрузить директорию (удалить папку)',
    'help.getchatid_command': '/getchatid - Узнать ID текущего чата',
    'help.new_command': '/new - Новый диалог (сбросить историю)',
    'help.ko_command': '/ко <текст> - Запустить команду через Codex (OpenAI). Codex может отвечать 10+ минут.',
    'help.kl_command': '/кл <текст> - Запустить команду через Claude (Anthropic)',
    'help.shortcuts': '⚡ Сокращения (можно без /):',
    'help.ko_shortcut': 'ко / co - то же что /ко или /co (Codex может отвечать 10+ минут)',
    'help.kl_shortcut': 'кл - то же что /кл',
    'help.private_default_note': '🗣️ В личке: если писать без команды — по умолчанию запускается Claude.\n💡 Если Claude ответил "You\'ve hit your limit", попробуйте Codex: начните с "ко " (или "co ").\n🕒 Codex может отвечать 10+ минут.',
    'help.group_privacy_note': '🛈 В группах используйте slash-команды: /кл и /ко (или /co).',

    // Group welcome
    'group.welcome': '👋 Привет! Я помогу вам создать AI-бота или веб-приложение.',
    'group.main_command': '💬 Команды:',
    'group.ko_description': '• /кл <ваш запрос> — Claude\n• /ко <ваш запрос> — Codex (может отвечать 10+ минут)',
    'group.execution_time': '⏱️ Выполнение может занять несколько минут, я буду присылать обновления статуса.',

    // Errors
    'error.chat_not_found': '❌ Не удалось определить чат',
    'error.file_upload_failed': '❌ Не удалось загрузить файл на сервер',
    'error.no_active_tasks': '❌ У вас нет активных задач для отмены',
    'error.directory_not_exists': 'ℹ️ Директория {dir} не существует',
    'error.reload_failed': '❌ Ошибка при перезагрузке: {error}',
    'error.onboarding_required': '❌ Сначала создайте проект через onboarding.\n\nНапишите /start чтобы начать.',
    'error.prompt_required': '❌ Укажите промпт после команды',
    'error.timeout': '❌ Превышено время ожидания ({minutes} минут)',
    'error.execution_failed': '❌ Ошибка выполнения:\n\n{error}',
    'error.internal': '❌ Произошла внутренняя ошибка бота. Попробуйте позже.',
    'error.working_dir_not_configured': '❌ Рабочая директория не настроена для этого чата.\n\nПопросите администратора настроить переменную окружения {envKey}.',
    'error.project_not_found': '❌ Проект с ID {id} не найден\n\nДиректория {dir} не существует.\nСоздайте папку или настройте маппинг в .env файле.',
    'error.cli_auth_required': '❌ Ошибка авторизации {provider} CLI\n\nНеобходимо авторизоваться на сервере:\n1. Подключитесь по SSH\n2. Выполните: {loginCmd}\n3. Перезапустите бота: {restartCmd}',
    'error.cli_no_output_failure': '⚠️ {provider} CLI завершился с ошибкой без вывода\n\nВозможные причины:\n• Не авторизован - выполните: {loginCmd}\n• Проблема с сетью или конфигурацией\n\nДля диагностики:\n1. Подключитесь по SSH\n2. Проверьте: {versionCmd}\n3. Авторизуйтесь: {loginCmd}',
    'error.cli_not_installed': '❌ {provider} CLI не установлен\n\nУстановите на сервере:\n{installCmd}',
    'error.sensitive_data_blocked': '⚠️ Ответ заблокирован: обнаружены приватные данные.\n\nПереформулируйте запрос.',

    // Chat info
    'chatinfo.id': '🆔 ID чата: {id}',
    'chatinfo.type': '📱 Тип: {type}',
    'chatinfo.title': '📝 Название: {title}',
    'chatinfo.username': '👤 Username: @{username}',

    // Conversation
    'conversation.reset': '🆕 Начинаем новый диалог!\nПредыдущая история ({count} сообщений) удалена.',

    // Files
    'file.uploaded': '📦 Файл загружен и доступен для скачивания:\n\n📄 Имя: {name}\n🔗 Ссылка: {url}\n📊 Размер: {size} MB',

    // Cancel
    'cancel.summary': '🛑 Отменено задач: {count}',
    'cancel.avg_elapsed': '⏱️ Средняя длительность: {seconds} секунд',

    // Restart
    'restart.no_directory': '❌ Нет директории для перезагрузки.\n\nНапишите /start чтобы создать новый проект.',
    'restart.success_private': '✅ Проект перезагружен!\n\nНапишите /start чтобы создать новый проект или используйте {codexCmd} для начала.',
    'restart.success_group': '✅ Директория перезагружена:\n{dir}\n\n📝 Используйте {codexCmd} для начала новой задачи',

    // Messages
    'message.continuation': '📄 Продолжение ({index}):',

    // Hints
    'hint.try_codex': '💡 Подсказка: попробуйте Codex — начните сообщение с "co " или "ко " (в группах: /co или /ко).\n🕒 Codex может отвечать 10+ минут.',

    // Onboarding steps
    'onboarding.idea_saved': '✅ Отлично! Запомнил вашу идею.\n\n🤖 Claude Code Box — это ваша личная виртуальная машина с ИИ (не физическая коробка)\nВнутри: Claude Code + Codex (две мощные нейросети)\nВы общаетесь с ними прямо в Telegram — как с обычным человеком, на русском.\nОни помогают писать код, сайты, боты и автоматизации.\n\n💰 Всё готово за 5000₽/мес (всё включено, без хлопот):\n✅ Claude Code (обычно 2000₽/мес)\n✅ Codex от ChatGPT (обычно 2000₽/мес)\n✅ Виртуальная машина-сервер 24/7 (всегда онлайн)\n✅ Управление через Telegram-бот (команды, статус, логи)\n✅ Стабильная работа из России без тормозов\n✅ Бэкапы, мониторинг и поддержка 24/7\n✅ Персональные консультации и менторство (@sashanoxon)\n\n🛡️ Гарантия возврата: 7 дней на тест. Откажитесь по любой причине — вернём деньги!\n\n💡 Сравните:\nОтдельный сервер + две подписки ≈ 7000₽/мес\nС нами: всё готово за 5000₽! Экономия 2000₽/мес + никаких настроек\n\n🆓 Бесплатная демка есть в @clodeboxbot — можно попробовать там.\n\n⚙️ Уже есть свои подписки?\nНастроим бесплатно! (Хватит даже одной — Claude или ChatGPT)\n\n❓ Какие подписки у вас есть?',
    'onboarding.server.has_server': '👍 Отлично! У вас есть сервер.\n\nВыберите где находится ваш сервер:',
    'onboarding.server.no_server': '🌐 Нет проблем! Мы можем арендовать сервер для вас.\n\nВыберите где хотите разместить сервер:',
    'onboarding.bot.create_bot': '🤖 Теперь создайте вашего Telegram бота:\n\n1️⃣ Перейдите в https://t.me/BotFather\n2️⃣ Отправьте команду /newbot\n3️⃣ Придумайте имя и username для бота\n4️⃣ BotFather даст вам токен (сохраните его!)',
    'onboarding.bot.token_request': '📤 Теперь пришлите мне токен вашего бота:',
    'onboarding.payment.subscription_options': '💳 Выберите тарифный план:',
    'onboarding.payment.own_keys': '🔑 Буду использовать свои ключи API',
    'onboarding.payment.our_keys': '⭐ Буду использовать ваши',
    'onboarding.payment.success': '🎉 Поздравляю с покупкой!\n✅ Ваша подписка активирована.\n🤖 Нейронки подключены и готовы к работе!',
    'onboarding.ssh.request': '🔐 Отправьте SSH данные в формате:\nssh root@ip_адрес -p порт (если не стандартный)\n\n📝 Пример:\nssh root@123.45.67.89',
    'onboarding.completion': '✅ Онбординг завершен! Теперь вы можете пользоваться ботом.',
    'onboarding.bot_token_valid': '✅ Токен валиден! Бот: @{username}\n\n🚀 Отлично! Начинаем настройку вашего Claude Code Box.\n\n⏳ Специалист свяжется с вами через несколько минут для завершения настройки.\n\n⏰ Если не будет ответа через 5 минут, напишите снова.',
    'onboarding.setup_starting': '🚀 Начинаем настройку вашего Claude Code Box.\n\n⏳ Специалист свяжется с вами через несколько минут.\n\n⏰ Если не будет ответа через 5 минут, напишите снова.',

    // Task execution
    'task.starting': '⏳ Запускаю задачу...',
    'task.running': '🔄 Выполняется... ({elapsed}с)',
    'task.completed': '✅ Задача выполнена за {time}с',
    'task.cancelled': '🚫 Задача отменена',
    'task.failed': '❌ Задача завершилась с ошибкой',
    // IMPORTANT: Do not claim success when the agent produced no output.
    // REF: User report 2026-02-10 "✅ Команда выполнена успешно (без вывода)".
    'task.success_no_output': '⚠️ Claude не прислал текстовый ответ. Повторите запрос чуть подробнее (например: "проверь и напиши, что сделал").',
    'task.codex_no_output_retry': '⚠️ Codex не прислал текстовый ответ. Повторите запрос чуть подробнее (например: "ко проверь и напиши, что сделал").',

    // Buttons
    'button.server_yes': '✅ Есть сервер',
    'button.server_no': '❌ Нет сервера',
    'button.keys_own': '🔑 Свои ключи',
    'button.keys_ours': '⭐ Ваши ключи',
    'button.server_abroad': '🌍 За рубежом',
    'button.server_rf': '🇷🇺 В РФ',
    'button.cancel_task': '🚫 Отменить задачу',
    'button.pay_stars': '⭐ Оплатить через Telegram Stars',
    'button.pay_external': '💳 Оплатить картой (внешняя ссылка)',
    'button.free_demo': '🆓 Хочу бесплатное демо',

    // Payment
    'payment.premium_choice': '⭐ Отличный выбор Premium сервиса!\n\n💰 Стоимость: 5000₽/мес (всё включено)\n🛡️ Гарантия возврата: 7 дней на тест\n👨‍💻 Поддержка, консультации и менторство включены (@sashanoxon)\n\n💳 Выберите способ оплаты:',
    'payment.stars_invoice_title': 'Claude Code Box Premium',
    'payment.stars_invoice_description': 'Месячная подписка: Claude Code + Codex + VPS сервер + поддержка 24/7',
    'payment.success': '🎉 Оплата прошла успешно!\n✅ Ваша подписка активирована.\n🤖 Нейронки подключены и готовы к работе!',

    // Activation
    'activation.success': '🎉 Поздравляю с покупкой!\n\n✅ Ваша подписка активирована.\n🤖 Нейронки подключены и готовы к работе!\n\n🗣️ Просто напишите сообщение (например, "Привет") — по умолчанию запустится Claude.\n\n💡 Если Claude ответил "You\'ve hit your limit", попробуйте Codex: начните с "ко " (или /ко в группе).\n🕒 Codex может отвечать 10+ минут.',
    'activation.free_success': '✅ Отлично! Запомнил вашу идею.\n\n🎉 Проект создан (бесплатный режим).\n\n🚀 Начинаю выполнение по вашей идее прямо сейчас.\n\n🌐 Важно: бесплатный домен (wpmix.net) в России может открываться только через VPN (из-за замедления трафика).\n\n💡 Если Claude ответил "You\'ve hit your limit", попробуйте Codex: начните с "ко " (или /ко в группе).\n🕒 Codex может отвечать 10+ минут.',
    'activation.ready': 'Нейронки подключены и готовы к работе',

    // Status messages
    'status.launching': '⏳ Запускаю {provider}...',
    'status.prompt': '📝 Промпт:',
    'status.history': '📚 История: {count} из 20 сообщений',
    'status.codex_slow_note': '🕒 Codex может отвечать очень долго (10+ минут) — это нормально.',
    'status.output_tail': '📟 Вывод (последние строки):',
    'status.running': '⏳ {provider} все еще работает...',
    'status.elapsed': '⏱️ Прошло: {seconds} секунд',

    // CLAUDE.md file content
    'claudemd.title': '# Проект',
    'claudemd.idea_section': '## Идея',
    'claudemd.no_description': 'Нет описания',
    'claudemd.instructions': '',
  },

  en: {
    // Start command messages
    'start.group': '👋 Hello! I will help you create an AI bot or web application.\n\n🧩 In groups, use commands:\n• /p <your request> — Claude\n• /co <your request> — Codex\n\n🗣️ In private chat you can just type (e.g., "Hello") — Claude runs by default.\n\n💡 If Claude replies "You\'ve hit your limit", try Codex: start with "co " (or /co in groups).\n\n🕒 Codex ("co") may take 10+ minutes to reply. This is normal.\n\n⏱️ Execution may take several minutes, I will send status updates.',
    'start.no_onboarding': '👋 Hello! Welcome to @clodeboxbot!\n\n🆓 You are using the free tier with a shared workspace.\n\n🗣️ In private chat you can just type (e.g., "Hello") — Claude runs by default.\n\n💡 If Claude replies "You\'ve hit your limit", try Codex: start with "co " (or /co in groups).\n\n🕒 Codex ("co") may take 10+ minutes to reply. This is normal.\n\n⏱️ Execution may take several minutes, I will send status updates.\n\n⭐ Want a personal workspace? Contact @noxonbot for premium subscription.',
    'start.onboarding_begin': '👋 Hello! I will help you create an AI bot or web application.\n\n💡 Tell me in simple words, what do you want to create?\n\n📝 Examples:\n• Landing page based on my presentation\n• Telegram bot for doctor appointments\n• Web application for financial tracking',
    'start.with_config': '👋 Hello! I am ready.\n\n🗣️ In private chat you can just type (e.g., "Hello") — Claude runs by default.\n\n💡 If Claude replies "You\'ve hit your limit", try Codex: start with "co " (or /co in groups).\n\n🕒 Codex ("co") may take 10+ minutes to reply. This is normal.\n\n⏱️ Execution may take several minutes, I will send status updates.',
    'start.crm': '👋 Hello! I will help you create a CRM system for your business.\n\n🎯 AI CRM Constructor - a CRM that adapts to your business processes.\n\n✅ No unnecessary features - only what you need\n✅ Fast implementation - 1-2 weeks\n✅ Full control - you own the source code\n\n💡 Describe your business and processes, and I will help create the perfect CRM:\n\n📝 Tell me:\n• What does your business do?\n• What are the main stages of customer interaction?\n• What needs to be tracked (customers, orders, projects)?\n• What integrations are needed (Telegram, email, payments)?',
    'start.simple_site': '🌐 Hello! I\'m SimpleSite - your AI assistant for creating landing pages and websites.\n\n💡 Just describe what you need:\n• "Hair salon landing page with booking form"\n• "Restaurant menu with prices"\n• "Photographer portfolio with contact form"\n\n🎨 I\'ll create a beautiful page with:\n• Modern responsive design\n• AI-generated background images\n• Contact/booking forms\n• Instant preview\n\n✨ What website would you like to create?',
    'start.simple_dashboard': '📊 Hello! I\'m SimpleDashboard - your AI assistant for building business dashboards.\n\n📁 Upload your data:\n• Excel file (.xlsx, .xls)\n• CSV file\n• Google Sheets link\n\n💡 Or describe what dashboard you need:\n• "Sales dashboard with monthly revenue chart"\n• "Marketing analytics with conversion funnel"\n• "Inventory tracking with low stock alerts"\n\n📈 I\'ll create professional dashboards with:\n• Interactive charts (line, bar, pie)\n• KPI cards with trends\n• Data tables with filters\n\n📚 Examples and prompts: {showcases_link}\n\n✨ What analytics would you like to see?',
    'start.simple_bounty': '🎯 Hello! I\'m SimpleBounty - your AI assistant for creating bounty campaigns.\n\n💡 Tell me what you need:\n• Campaign name\n• Description and goal\n• Tasks with point rewards\n\n📋 I will help you:\n• Create a campaign with tasks\n• Set up rewards for each task\n• Fund the escrow with points\n• Publish a page for participants\n\n✨ What campaign would you like to create?',

    // Help command
    'help.title': '🤖 Noxon Bot - Help',
    'help.commands_header': '📝 Commands:',
    'help.start_command': '/start - Welcome and information',
    'help.help_command': '/help - This help',
    'help.cancel_command': '/cancel - Cancel active task',
    'help.restart_command': '/restart - Reload directory (delete folder)',
    'help.getchatid_command': '/getchatid - Show current chat ID',
    'help.new_command': '/new - New dialog (reset history)',
    'help.ko_command': '/co <text> - Run command via Codex (OpenAI). May take 10+ minutes.',
    'help.kl_command': '/p <text> - Run command via Claude (Anthropic)',
    'help.shortcuts': '⚡ Shortcuts (can be used without /):',
    'help.ko_shortcut': 'co - same as /co (Codex may take 10+ minutes)',
    'help.kl_shortcut': 'p - same as /p',
    'help.private_default_note': '🗣️ In private chat: if you type without a command, Claude runs by default.\n💡 If Claude replies \"You\'ve hit your limit\", try Codex: start with \"co \".\n🕒 Codex may take 10+ minutes.',
    'help.group_privacy_note': '🛈 In groups use slash-commands: /p and /co.',

    // Group welcome
    'group.welcome': '👋 Hello! I will help you create an AI bot or web application.',
    'group.main_command': '💬 Commands:',
    'group.ko_description': '• /p <your request> — Claude\n• /co <your request> — Codex (may take 10+ minutes)',
    'group.execution_time': '⏱️ Execution may take several minutes, I will send status updates.',

    // Errors
    'error.chat_not_found': '❌ Could not determine chat',
    'error.file_upload_failed': '❌ Failed to upload file to server',
    'error.no_active_tasks': '❌ You have no active tasks to cancel',
    'error.directory_not_exists': 'ℹ️ Directory {dir} does not exist',
    'error.reload_failed': '❌ Error during reload: {error}',
    'error.onboarding_required': '❌ Please create a project via onboarding first.\n\nSend /start to begin.',
    'error.prompt_required': '❌ Specify prompt after command',
    'error.timeout': '❌ Timeout exceeded ({minutes} minutes)',
    'error.execution_failed': '❌ Execution error:\n\n{error}',
    'error.internal': '❌ Internal bot error. Please try again later.',
    'error.working_dir_not_configured': '❌ Working directory is not configured for this chat.\n\nAsk an admin to set environment variable {envKey}.',
    'error.project_not_found': '❌ Project with ID {id} not found\n\nDirectory {dir} does not exist.\nCreate it or configure mapping in the .env file.',
    'error.cli_auth_required': '❌ {provider} CLI authentication error\n\nPlease authenticate on the server:\n1. Connect via SSH\n2. Run: {loginCmd}\n3. Restart the bot: {restartCmd}',
    'error.cli_no_output_failure': '⚠️ {provider} CLI failed with no output\n\nPossible reasons:\n• Not logged in - run: {loginCmd}\n• Network or configuration issue\n\nTo debug:\n1. Connect via SSH\n2. Check: {versionCmd}\n3. Log in: {loginCmd}',
    'error.cli_not_installed': '❌ {provider} CLI is not installed\n\nInstall on the server:\n{installCmd}',
    'error.sensitive_data_blocked': '⚠️ Response blocked: private data detected.\n\nPlease rephrase your request.',

    // Chat info
    'chatinfo.id': '🆔 Chat ID: {id}',
    'chatinfo.type': '📱 Type: {type}',
    'chatinfo.title': '📝 Title: {title}',
    'chatinfo.username': '👤 Username: @{username}',

    // Conversation
    'conversation.reset': '🆕 Starting a new dialog!\nPrevious history ({count} messages) removed.',

    // Files
    'file.uploaded': '📦 File uploaded and available for download:\n\n📄 Name: {name}\n🔗 URL: {url}\n📊 Size: {size} MB',

    // Cancel
    'cancel.summary': '🛑 Cancelled tasks: {count}',
    'cancel.avg_elapsed': '⏱️ Average duration: {seconds} seconds',

    // Restart
    'restart.no_directory': '❌ No directory to reload.\n\nSend /start to create a new project.',
    'restart.success_private': '✅ Project reloaded!\n\nSend /start to create a new project or use {codexCmd} to begin.',
    'restart.success_group': '✅ Directory reloaded:\n{dir}\n\n📝 Use {codexCmd} to start a new task',

    // Messages
    'message.continuation': '📄 Continuation ({index}):',

    // Hints
    'hint.try_codex': '💡 Tip: try Codex — start your message with "co " (or use /co in groups).\n🕒 Codex may take 10+ minutes.',

    // Onboarding steps
    'onboarding.idea_saved': '✅ Great! I saved your idea.\n\n🤖 Claude Code Box — your personal AI-powered virtual machine (not a physical box)\nInside: Claude Code + Codex (two powerful AI models)\nYou interact with them directly in Telegram — like chatting with a person, in plain English.\nThey help you write code, websites, bots, and automations.\n\n💰 All-inclusive for $65/month (no hassle):\n✅ Claude Code (usually $25/month)\n✅ Codex from ChatGPT (usually $25/month)\n✅ Virtual machine server 24/7 (always online)\n✅ Telegram bot management (commands, status, logs)\n✅ Stable operation with global access\n✅ Backups, monitoring, and 24/7 support\n✅ Personal consultations and mentorship (@sashanoxon)\n\n🛡️ Money-back guarantee: 7-day trial. Cancel for any reason — full refund!\n\n💡 Compare:\nSeparate server + two subscriptions ≈ $90/month\nWith us: all-in-one for $65! Save $25/month + zero setup\n\n🆓 Free demo is available in @clodeboxbot — you can try it there.\n\n⚙️ Already have your own subscriptions?\nWe\'ll set it up for free! (Even one is enough — Claude or ChatGPT)\n\n❓ What subscriptions do you have?',
    'onboarding.server.has_server': '👍 Great! You have a server.\n\nChoose where your server is located:',
    'onboarding.server.no_server': '🌐 No problem! We can rent a server for you.\n\nChoose where you want to host the server:',
    'onboarding.bot.create_bot': '🤖 Now create your Telegram bot:\n\n1️⃣ Go to https://t.me/BotFather\n2️⃣ Send command /newbot\n3️⃣ Choose a name and username for the bot\n4️⃣ BotFather will give you a token (save it!)',
    'onboarding.bot.token_request': '📤 Now send me your bot token:',
    'onboarding.payment.subscription_options': '💳 Choose a subscription plan:',
    'onboarding.payment.own_keys': '🔑 I will use my own API keys',
    'onboarding.payment.our_keys': '⭐ I will use yours',
    'onboarding.payment.success': '🎉 Congratulations on your purchase!\n✅ Your subscription is activated.\n🤖 AI models are connected and ready to work!',
    'onboarding.ssh.request': '🔐 Send SSH credentials in format:\nssh root@ip_address -p port (if non-standard)\n\n📝 Example:\nssh root@123.45.67.89',
    'onboarding.completion': '✅ Onboarding completed! You can now use the bot.',
    'onboarding.bot_token_valid': '✅ Token is valid! Bot: @{username}\n\n🚀 Great! Starting setup of your Claude Code Box.\n\n⏳ A specialist will contact you in a few minutes to complete the setup.\n\n⏰ If no response within 5 minutes, please write again.',
    'onboarding.setup_starting': '🚀 Starting setup of your Claude Code Box.\n\n⏳ A specialist will contact you in a few minutes.\n\n⏰ If no response within 5 minutes, please write again.',

    // Task execution
    'task.starting': '⏳ Starting task...',
    'task.running': '🔄 Running... ({elapsed}s)',
    'task.completed': '✅ Task completed in {time}s',
    'task.cancelled': '🚫 Task cancelled',
    'task.failed': '❌ Task failed with error',
    // IMPORTANT: Do not claim success when the agent produced no output.
    // REF: User report 2026-02-10 "Command completed successfully (no output)".
    'task.success_no_output': '⚠️ Claude returned no text response. Please retry with a slightly more specific request.',
    'task.codex_no_output_retry': '⚠️ Codex returned no text response. Please retry with a slightly more specific request.',

    // Buttons
    'button.server_yes': '✅ Have server',
    'button.server_no': '❌ No server',
    'button.keys_own': '🔑 Own keys',
    'button.keys_ours': '⭐ Your keys',
    'button.server_abroad': '🌍 Abroad',
    'button.server_rf': '🇷🇺 In Russia',
    'button.cancel_task': '🚫 Cancel task',
    'button.pay_stars': '⭐ Pay with Telegram Stars',
    'button.pay_external': '💳 Pay with card (external link)',
    'button.free_demo': '🆓 I want free demo',

    // Payment
    'payment.premium_choice': '⭐ Great choice of Premium service!\n\n💰 Price: $65/month (all-inclusive)\n🛡️ Money-back guarantee: 7-day trial\n👨‍💻 Support, consultations, and mentorship included (@sashanoxon)\n\n💳 Choose payment method:',
    'payment.stars_invoice_title': 'Claude Code Box Premium',
    'payment.stars_invoice_description': 'Monthly subscription: Claude Code + Codex + VPS server + 24/7 support',
    'payment.success': '🎉 Payment successful!\n✅ Your subscription is activated.\n🤖 AI models are connected and ready to work!',

    // Activation
    'activation.success': '🎉 Congratulations on your purchase!\n\n✅ Your subscription is activated.\n🤖 AI models connected and ready to work!\n\n🗣️ Just type (e.g., "Hello") — Claude runs by default.\n\n💡 If Claude replies "You\'ve hit your limit", try Codex: start with "co " (or /co in groups).\n🕒 Codex may take 10+ minutes.',
    'activation.free_success': '✅ Great! I saved your idea.\n\n🎉 Your project workspace is ready (free mode).\n\n🚀 Starting execution based on your idea right now.\n\n💡 If Claude replies "You\'ve hit your limit", try Codex: start with "co " (or /co in groups).\n🕒 Codex may take 10+ minutes.',
    'activation.ready': 'AI models connected and ready to work',

    // Status messages
    'status.launching': '⏳ Launching {provider}...',
    'status.prompt': '📝 Prompt:',
    'status.history': '📚 History: {count} of 20 messages',
    'status.codex_slow_note': '🕒 Codex may take 10+ minutes to reply. This is normal.',
    'status.output_tail': '📟 Output (tail):',
    'status.running': '⏳ {provider} is still working...',
    'status.elapsed': '⏱️ Elapsed: {seconds} seconds',

    // CLAUDE.md file content
    'claudemd.title': '# Project',
    'claudemd.idea_section': '## Idea',
    'claudemd.no_description': 'No description',
    'claudemd.instructions': '\n\n## Instructions\n\n**IMPORTANT: Answer in English by default.**\n',
  }
};

/**
 * Get translation for a key
 * @param lang Language code
 * @param key Translation key
 * @param params Optional parameters for string interpolation
 */
export function t(lang: Language, key: keyof TranslationStrings, params?: Record<string, string>): string {
  let translation = translations[lang][key];

  if (params) {
    Object.keys(params).forEach(paramKey => {
      translation = translation.replace(`{${paramKey}}`, params[paramKey]);
    });
  }

  return translation;
}

/**
 * Detect language from bot token or configuration
 * @param token Bot token
 * @returns Language code
 */
export function detectLanguage(token: string): Language {
  // English bot token: 8504337003:AAFILG85FYnLP7dWdJRpZBSf1WzJuQaC4uk (@coderboxbot)
  if (token.startsWith('8504337003:')) {
    return 'en';
  }

  // Default to Russian for noxonbot
  return 'ru';
}
