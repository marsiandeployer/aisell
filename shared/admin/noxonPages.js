function escapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toRuDateTime(value) {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('ru-RU');
}

function truncate(value, maxLen) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLen - 1))}…`;
}

function maskSecret(value) {
  if (!value) {
    return '—';
  }
  const text = String(value);
  const trimmed = text.trim();
  if (!trimmed) {
    return '—';
  }
  if (trimmed.length <= 8) {
    return '********';
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function normalizeUserId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim() && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function renderNoxonNavLinks(basePath) {
  return `
    <nav class="mb-4 flex gap-4 text-sm">
      <a href="${basePath}" class="text-blue-600 hover:underline">Leads</a>
      <a href="${basePath}/referrals" class="text-blue-600 hover:underline">Referrals</a>
      <a href="${basePath}/onboarding" class="text-blue-600 hover:underline">Onboarding</a>
    </nav>
  `;
}

function renderNoxonLeadsBody(basePath, leads, messages) {
  const safeBasePath = typeof basePath === 'string' ? basePath : '/admin';
  const safeLeads = Array.isArray(leads) ? leads : [];
  const safeMessages = Array.isArray(messages) ? messages : [];

  const rowsHtml = safeLeads
    .slice()
    .sort((a, b) => {
      const aTs = a && a.timestamp ? Date.parse(a.timestamp) : 0;
      const bTs = b && b.timestamp ? Date.parse(b.timestamp) : 0;
      return bTs - aTs;
    })
    .map((lead) => {
      const userId = normalizeUserId(lead && lead.userId);
      const idea = escapeHtml(lead && lead.idea ? lead.idea : 'Не указана');
      const hasServer = lead && lead.hasServer ? '✅ Да' : '❌ Нет';
      const ssh = lead && lead.sshCredentials ? escapeHtml(lead.sshCredentials) : '—';
      const date = toRuDateTime(lead && lead.timestamp);

      const messageCount = userId
        ? safeMessages.filter((m) => normalizeUserId(m && m.userId) === userId).length
        : 0;

      const authorLink = userId
        ? `<a href="${safeBasePath}/authors/${encodeURIComponent(userId)}" class="text-blue-600 hover:underline">${escapeHtml(userId)}</a>`
        : '—';

      const messagesLink = userId
        ? `<a href="${safeBasePath}/authors/${encodeURIComponent(userId)}" class="text-blue-600 hover:underline">💬 Диалог (${messageCount})</a>`
        : '—';

      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="py-3 px-4">${escapeHtml(date)}</td>
          <td class="py-3 px-4 font-mono">${authorLink}</td>
          <td class="py-3 px-4">${idea}</td>
          <td class="py-3 px-4 text-center">${hasServer}</td>
          <td class="py-3 px-4 font-mono text-sm whitespace-pre-wrap break-words">${ssh}</td>
          <td class="py-3 px-4">${messagesLink}</td>
        </tr>
      `;
    })
    .join('');

  return `
    ${renderNoxonNavLinks(safeBasePath)}
    <div class="mb-4 text-sm text-gray-600">
      Всего лидов: <span class="font-bold">${safeLeads.length}</span>
    </div>
    <div class="overflow-x-auto">
      <table class="min-w-full bg-white">
        <thead class="bg-gray-200">
          <tr>
            <th class="py-3 px-4 text-left">Дата</th>
            <th class="py-3 px-4 text-left">User ID</th>
            <th class="py-3 px-4 text-left">Идея проекта</th>
            <th class="py-3 px-4 text-center">Есть сервер</th>
            <th class="py-3 px-4 text-left">SSH</th>
            <th class="py-3 px-4 text-left">Действия</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="6" class="py-8 text-center text-gray-500">Нет данных</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderNoxonMessagesBody(basePath, userId, messages) {
  const safeBasePath = typeof basePath === 'string' ? basePath : '/admin';
  const safeUserId = normalizeUserId(userId);
  const safeMessages = Array.isArray(messages) ? messages : [];
  const userMessages = safeUserId
    ? safeMessages.filter((m) => normalizeUserId(m && m.userId) === safeUserId)
    : [];

  const messagesHtml = userMessages
    .slice()
    .sort((a, b) => {
      const aTs = a && a.timestamp ? Date.parse(a.timestamp) : 0;
      const bTs = b && b.timestamp ? Date.parse(b.timestamp) : 0;
      return aTs - bTs;
    })
    .map((msg) => {
      const date = toRuDateTime(msg && msg.timestamp);
      const text = escapeHtml(msg && typeof msg.text === 'string' ? msg.text : '');
      const isUser = msg && msg.from === 'user';
      const bgColor = isUser ? 'bg-blue-50' : 'bg-gray-50';
      const fromLabel = isUser ? '👤 Пользователь' : '🤖 Бот';

      return `
        <div class="p-4 mb-2 rounded ${bgColor}">
          <div class="text-xs text-gray-600 mb-1">${escapeHtml(date)} · ${fromLabel}</div>
          <div class="text-gray-800 whitespace-pre-wrap break-words">${text}</div>
        </div>
      `;
    })
    .join('');

  return `
    ${renderNoxonNavLinks(safeBasePath)}
    <div class="mb-6">
      <a href="${safeBasePath}" class="text-blue-600 hover:underline">← Назад к списку</a>
    </div>
    <h2 class="text-2xl font-bold mb-6 text-gray-800">💬 Диалог с пользователем ${escapeHtml(safeUserId || '—')}</h2>
    <div class="mb-4 text-sm text-gray-600">
      Всего сообщений: <span class="font-bold">${userMessages.length}</span>
    </div>
    <div class="space-y-2">
      ${messagesHtml || '<div class="text-center text-gray-500 py-8">Нет сообщений</div>'}
    </div>
  `;
}

function renderNoxonReferralsBody(basePath, entries) {
  const safeBasePath = typeof basePath === 'string' ? basePath : '/admin';
  const safeEntries = Array.isArray(entries) ? entries : [];

  const rowsHtml = safeEntries
    .slice()
    .sort((a, b) => {
      const aTs = a && a.referralDate ? Date.parse(a.referralDate) : 0;
      const bTs = b && b.referralDate ? Date.parse(b.referralDate) : 0;
      return bTs - aTs;
    })
    .map((entry) => {
      const userId = normalizeUserId(entry && entry.userId);
      const username = entry && entry.username ? `@${String(entry.username).replace(/^@/, '')}` : '—';
      const source = entry && entry.referralSource ? String(entry.referralSource) : '—';
      const param = entry && entry.referralParam ? String(entry.referralParam) : '—';
      const date = toRuDateTime(entry && entry.referralDate);
      const lang = entry && entry.botLanguage ? String(entry.botLanguage) : '—';
      const proc = entry && entry.botProcessName ? String(entry.botProcessName) : '—';

      const messagesLink = userId
        ? `<a href="${safeBasePath}/authors/${encodeURIComponent(userId)}" class="text-blue-600 hover:underline">💬 диалог</a>`
        : '—';

      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="py-3 px-4">${escapeHtml(date)}</td>
          <td class="py-3 px-4 font-mono">${escapeHtml(userId || '—')}</td>
          <td class="py-3 px-4">${escapeHtml(username)}</td>
          <td class="py-3 px-4">${escapeHtml(source)}</td>
          <td class="py-3 px-4 font-mono text-xs">${escapeHtml(param)}</td>
          <td class="py-3 px-4 text-xs">${escapeHtml(lang)} / ${escapeHtml(proc)}</td>
          <td class="py-3 px-4">${messagesLink}</td>
        </tr>
      `;
    })
    .join('');

  return `
    ${renderNoxonNavLinks(safeBasePath)}
    <div class="mb-4 text-sm text-gray-600">
      Всего записей: <span class="font-bold">${safeEntries.length}</span>
    </div>
    <div class="overflow-x-auto">
      <table class="min-w-full bg-white">
        <thead class="bg-gray-200">
          <tr>
            <th class="py-3 px-4 text-left">Дата</th>
            <th class="py-3 px-4 text-left">User ID</th>
            <th class="py-3 px-4 text-left">Username</th>
            <th class="py-3 px-4 text-left">Источник</th>
            <th class="py-3 px-4 text-left">Param</th>
            <th class="py-3 px-4 text-left">Bot</th>
            <th class="py-3 px-4 text-left">Действия</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="7" class="py-8 text-center text-gray-500">Нет данных</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderNoxonOnboardingBody(basePath, statesByUserId) {
  const safeBasePath = typeof basePath === 'string' ? basePath : '/admin';
  const safeStates = statesByUserId && typeof statesByUserId === 'object' ? statesByUserId : {};
  const rows = Object.entries(safeStates).map(([userId, state]) => ({ userId, state }));

  rows.sort((a, b) => {
    const aStep = a.state && a.state.step ? String(a.state.step) : '';
    const bStep = b.state && b.state.step ? String(b.state.step) : '';
    if (aStep === bStep) {
      return Number(b.userId) - Number(a.userId);
    }
    return aStep.localeCompare(bStep);
  });

  const rowsHtml = rows
    .map(({ userId, state }) => {
      const step = state && state.step ? String(state.step) : '—';
      const ideaPreview = truncate(state && typeof state.idea === 'string' ? state.idea : '', 80);
      const hasServer = state && typeof state.hasServer === 'boolean' ? (state.hasServer ? '✅' : '❌') : '—';
      const isPremium = state && typeof state.isPremium === 'boolean' ? (state.isPremium ? '✅' : '❌') : '—';
      const activationCode = maskSecret(state && state.activationCode);
      const botUsername = state && state.botUsername ? String(state.botUsername) : '—';
      const botToken = state && state.botToken ? maskSecret(state.botToken) : '—';

      const messagesLink = userId
        ? `<a href="${safeBasePath}/authors/${encodeURIComponent(userId)}" class="text-blue-600 hover:underline">💬 диалог</a>`
        : '—';

      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="py-3 px-4 font-mono">${escapeHtml(userId)}</td>
          <td class="py-3 px-4">${escapeHtml(step)}</td>
          <td class="py-3 px-4">${escapeHtml(ideaPreview || '—')}</td>
          <td class="py-3 px-4 text-center">${escapeHtml(hasServer)}</td>
          <td class="py-3 px-4 text-center">${escapeHtml(isPremium)}</td>
          <td class="py-3 px-4 font-mono text-xs">${escapeHtml(activationCode)}</td>
          <td class="py-3 px-4 font-mono text-xs">${escapeHtml(botUsername)}</td>
          <td class="py-3 px-4 font-mono text-xs">${escapeHtml(botToken)}</td>
          <td class="py-3 px-4">${messagesLink}</td>
        </tr>
      `;
    })
    .join('');

  return `
    ${renderNoxonNavLinks(safeBasePath)}
    <div class="mb-4 text-sm text-gray-600">
      Всего пользователей в onboarding: <span class="font-bold">${rows.length}</span>
    </div>
    <div class="overflow-x-auto">
      <table class="min-w-full bg-white">
        <thead class="bg-gray-200">
          <tr>
            <th class="py-3 px-4 text-left">User ID</th>
            <th class="py-3 px-4 text-left">Step</th>
            <th class="py-3 px-4 text-left">Idea</th>
            <th class="py-3 px-4 text-center">Server</th>
            <th class="py-3 px-4 text-center">Premium</th>
            <th class="py-3 px-4 text-left">Activation</th>
            <th class="py-3 px-4 text-left">Bot @</th>
            <th class="py-3 px-4 text-left">Bot Token</th>
            <th class="py-3 px-4 text-left">Действия</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="9" class="py-8 text-center text-gray-500">Нет данных</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

module.exports = {
  escapeHtml,
  maskSecret,
  normalizeUserId,
  renderNoxonLeadsBody,
  renderNoxonMessagesBody,
  renderNoxonReferralsBody,
  renderNoxonOnboardingBody,
};
