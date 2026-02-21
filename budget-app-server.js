const ACCOUNTS_KEY = 'budgetAccounts_v1';
const SESSION_KEY = 'budgetSessionUser_v1';
const LEGACY_KEY = 'budgetAppData_v1';

let accounts = {};
let activeUser = null;
let state = { income: [], expenses: [], recurringBills: [], targets: [] };
let charts = {};

function getCutoffDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 14, now.getDate());
}

function monthKey(dateLike) {
  return new Date(dateLike).toISOString().slice(0, 7);
}

function currentMonthKey() {
  return monthKey(new Date());
}

function toCurrency(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

function loadAccounts() {
  const raw = localStorage.getItem(ACCOUNTS_KEY);
  if (!raw) {
    accounts = {};
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    accounts = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    accounts = {};
  }
}

function saveAccounts() {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function getLegacyBudgetData() {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      income: Array.isArray(parsed.income) ? parsed.income : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      recurringBills: Array.isArray(parsed.recurringBills) ? parsed.recurringBills : [],
      targets: Array.isArray(parsed.targets) ? parsed.targets : []
    };
  } catch {
    return null;
  }
}

function ensureUserRecord(username) {
  if (!accounts[username]) {
    accounts[username] = { password: '', income: [], expenses: [], recurringBills: [], targets: [] };
  }

  const cutoff = getCutoffDate();
  const user = accounts[username];
  user.income = (user.income || []).filter(i => new Date(i.date) >= cutoff);
  user.expenses = (user.expenses || []).filter(e => new Date(e.date) >= cutoff);
  user.recurringBills = user.recurringBills || [];
  user.targets = (user.targets || []).filter(t => {
    if (!t.month) return false;
    const targetMonthDate = new Date(`${t.month}-01T00:00:00.000Z`);
    return targetMonthDate >= new Date(cutoff.getFullYear(), cutoff.getMonth(), 1);
  });
  return user;
}

function loadActiveState() {
  if (!activeUser) {
    state = { income: [], expenses: [], recurringBills: [], targets: [] };
    return;
  }

  const user = ensureUserRecord(activeUser);
  state = {
    income: user.income,
    expenses: user.expenses,
    recurringBills: user.recurringBills,
    targets: user.targets
  };
}

function persistActiveState() {
  if (!activeUser) return;
  const user = ensureUserRecord(activeUser);
  user.income = state.income;
  user.expenses = state.expenses;
  user.recurringBills = state.recurringBills;
  user.targets = state.targets;
  saveAccounts();
}

function setSession(username) {
  activeUser = username;
  if (username) {
    localStorage.setItem(SESSION_KEY, username);
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

function loadSession() {
  const sessionUser = normalizeUsername(localStorage.getItem(SESSION_KEY));
  if (!sessionUser || !accounts[sessionUser]) {
    setSession(null);
    return;
  }

  setSession(sessionUser);
}

function registerAccount(usernameRaw, passwordRaw) {
  const username = normalizeUsername(usernameRaw);
  const password = String(passwordRaw || '');

  if (username.length < 3) return 'Username must be at least 3 characters.';
  if (password.length < 6) return 'Password must be at least 6 characters.';
  if (accounts[username]) return 'That username already exists.';

  accounts[username] = { password, income: [], expenses: [], recurringBills: [], targets: [] };

  if (Object.keys(accounts).length === 1) {
    const legacy = getLegacyBudgetData();
    if (legacy) {
      accounts[username].income = legacy.income;
      accounts[username].expenses = legacy.expenses;
      accounts[username].recurringBills = legacy.recurringBills;
      accounts[username].targets = legacy.targets;
    }
  }

  saveAccounts();
  setSession(username);
  loadActiveState();
  return '';
}

function loginAccount(usernameRaw, passwordRaw) {
  const username = normalizeUsername(usernameRaw);
  const password = String(passwordRaw || '');
  const account = accounts[username];

  if (!account) return 'Account not found.';
  if (account.password !== password) return 'Incorrect password.';

  setSession(username);
  loadActiveState();
  return '';
}

function logoutAccount() {
  setSession(null);
  state = { income: [], expenses: [], recurringBills: [], targets: [] };
  Object.values(charts).forEach(chart => chart && chart.destroy && chart.destroy());
  charts = {};
}

function totals() {
  const incomeTotal = state.income.reduce((sum, item) => sum + Number(item.amount), 0);
  const expenseTotal = state.expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  const now = new Date();
  const currentMonth = currentMonthKey();

  const incByCat = {};
  state.income.forEach(item => {
    incByCat[item.category] = (incByCat[item.category] || 0) + Number(item.amount);
  });

  const expByCat = {};
  state.expenses.forEach(item => {
    expByCat[item.category] = (expByCat[item.category] || 0) + Number(item.amount);
  });

  const monthlyIncome = state.income
    .filter(item => monthKey(item.date) === currentMonth)
    .reduce((sum, item) => sum + Number(item.amount), 0);

  const monthlyExpenses = state.expenses
    .filter(item => monthKey(item.date) === currentMonth)
    .reduce((sum, item) => sum + Number(item.amount), 0);

  const rolling90DayExpenses = state.expenses
    .filter(item => (now - new Date(item.date)) <= 90 * 86400000)
    .reduce((sum, item) => sum + Number(item.amount), 0);

  const monthlyBurnRate = rolling90DayExpenses / 3;
  const availableCash = incomeTotal - expenseTotal;
  const runwayMonths = monthlyBurnRate > 0 ? availableCash / monthlyBurnRate : Infinity;
  const taxReserve = monthlyIncome * 0.30;

  return {
    incomeTotal,
    expenseTotal,
    net: incomeTotal - expenseTotal,
    incByCat,
    expByCat,
    monthlyIncome,
    monthlyExpenses,
    monthlyBurnRate,
    runwayMonths,
    taxReserve
  };
}

function buildMonthlyReport() {
  const t = totals();
  const month = currentMonthKey();
  const lines = [
    `Monthly Report (${month})`,
    `Income: ${toCurrency(t.monthlyIncome)}`,
    `Expenses: ${toCurrency(t.monthlyExpenses)}`,
    `Net: ${toCurrency(t.monthlyIncome - t.monthlyExpenses)}`,
    `Suggested Tax Reserve (30%): ${toCurrency(t.taxReserve)}`,
    `Estimated Burn Rate: ${toCurrency(t.monthlyBurnRate)}/month`,
    `Estimated Cash Runway: ${Number.isFinite(t.runwayMonths) ? `${Math.max(t.runwayMonths, 0).toFixed(1)} months` : '∞'}`
  ];

  const monthTargets = state.targets.filter(target => target.month === month);
  if (monthTargets.length) {
    lines.push('', 'Targets:');
    monthTargets.forEach(target => {
      const spent = state.expenses
        .filter(item => monthKey(item.date) === month && item.category === target.category)
        .reduce((sum, item) => sum + Number(item.amount), 0);
      lines.push(`- ${target.category}: ${toCurrency(spent)} / ${toCurrency(target.amount)}`);
    });
  }

  return lines.join('\n');
}

function downloadText(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const rows = [['type', 'category', 'amount', 'date', 'frequency', 'lastPaid']];

  state.income.forEach(item => {
    rows.push(['income', item.category, Number(item.amount).toFixed(2), item.date, '', '']);
  });

  state.expenses.forEach(item => {
    rows.push(['expense', item.category, Number(item.amount).toFixed(2), item.date, '', '']);
  });

  state.recurringBills.forEach(item => {
    rows.push(['recurring_bill', item.category, Number(item.amount).toFixed(2), item.date, item.frequency || '', item.lastPaid || '']);
  });

  const csv = rows
    .map(row => row.map(value => `"${String(value || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  downloadText(`budget-export-${activeUser || 'user'}-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
}

function renderTargetList() {
  const targetList = document.getElementById('targetList');
  if (!targetList) return;

  const month = currentMonthKey();
  const monthTargets = state.targets.filter(target => target.month === month);
  targetList.innerHTML = '';

  if (!monthTargets.length) {
    targetList.innerHTML = '<div class="empty-state">No targets set for this month</div>';
    return;
  }

  monthTargets.forEach((target, index) => {
    const spent = state.expenses
      .filter(item => monthKey(item.date) === month && item.category === target.category)
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const row = document.createElement('div');
    row.className = 'entry-item';
    row.innerHTML = `<div class="entry-info"><div class="entry-category">${target.category}</div><div class="entry-date">${month} • Spent ${toCurrency(spent)} of ${toCurrency(target.amount)}</div></div><div class="entry-amount">${Math.max((spent / target.amount) * 100, 0).toFixed(0)}%</div>`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      const currentMonthTargets = state.targets.filter(item => item.month === month);
      const targetToDelete = currentMonthTargets[index];
      state.targets = state.targets.filter(item => !(item.month === targetToDelete.month && item.category === targetToDelete.category));
      persistActiveState();
      renderDashboard();
    };

    row.appendChild(deleteBtn);
    targetList.appendChild(row);
  });
}

function applyRecurring() {
  const today = new Date();
  state.recurringBills.forEach(bill => {
    const lastPaid = bill.lastPaid ? new Date(bill.lastPaid) : null;
    const start = new Date(bill.date);
    if (today < start) return;

    let shouldApply = false;
    if (bill.frequency === 'daily') shouldApply = !lastPaid || (today - lastPaid) >= 86400000;
    if (bill.frequency === 'weekly') shouldApply = !lastPaid || (today - lastPaid) >= 7 * 86400000;
    if (bill.frequency === 'monthly') {
      shouldApply = !lastPaid || today.getMonth() !== lastPaid.getMonth() || today.getFullYear() !== lastPaid.getFullYear();
    }

    if (shouldApply) bill.lastPaid = today.toISOString();
  });

  persistActiveState();
}

function drawChart(elId, labels, data) {
  const canvas = document.getElementById(elId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (charts[elId]) charts[elId].destroy();

  if (!labels.length) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.font = '16px Arial';
    ctx.fillStyle = '#999';
    ctx.textAlign = 'center';
    ctx.fillText('No data', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  charts[elId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map(label => label.includes('(Recurring)') ? 'rgba(255,159,64,0.8)' : 'rgba(54,162,235,0.8)'),
        borderColor: 'white',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: context => '$' + context.parsed.toFixed(2)
          }
        }
      }
    }
  });
}

function payRecurring(index) {
  const bill = state.recurringBills[index];
  if (!bill) return;

  const dateStr = new Date().toISOString();
  state.expenses.push({ amount: Number(bill.amount), category: bill.category, date: dateStr });
  bill.lastPaid = dateStr;
  persistActiveState();
  renderDashboard();
}

function renderAuthError(message) {
  const errorEl = document.getElementById('authError');
  if (!errorEl) return;
  errorEl.textContent = message || '';
  errorEl.style.display = message ? 'block' : 'none';
}

function toggleScreens(isLoggedIn) {
  const authScreen = document.getElementById('authScreen');
  const dashboard = document.getElementById('dashboardApp');
  if (authScreen) authScreen.style.display = isLoggedIn ? 'none' : 'grid';
  if (dashboard) dashboard.style.display = isLoggedIn ? 'block' : 'none';
}

function renderDashboard() {
  if (!activeUser) {
    toggleScreens(false);
    renderAuthError('');
    return;
  }

  toggleScreens(true);
  const currentUserEl = document.getElementById('currentUser');
  if (currentUserEl) currentUserEl.textContent = activeUser;

  applyRecurring();
  const t = totals();

  document.getElementById('today').textContent = new Date().toISOString().slice(0, 10);
  document.getElementById('incomeTotal').textContent = toCurrency(t.incomeTotal);
  document.getElementById('expenseTotal').textContent = toCurrency(t.expenseTotal);

  const netVal = document.getElementById('netVal');
  netVal.textContent = `${t.net < 0 ? '-' : ''}${toCurrency(Math.abs(t.net))}`;
  document.getElementById('netCard').classList.toggle('negative', t.net < 0);

  const runwayVal = document.getElementById('runwayVal');
  const runwayCard = document.getElementById('runwayCard');
  const safeRunway = Math.max(t.runwayMonths, 0);
  runwayVal.textContent = Number.isFinite(t.runwayMonths) ? `${safeRunway.toFixed(1)} mo` : '∞';
  runwayCard.classList.toggle('negative', Number.isFinite(t.runwayMonths) && t.runwayMonths < 1);

  document.getElementById('taxReserveVal').textContent = toCurrency(t.taxReserve);

  const recurringList = document.getElementById('recurringList');
  recurringList.innerHTML = '';
  if (!state.recurringBills.length) recurringList.innerHTML = '<div class="empty-state">No recurring bills yet</div>';

  state.recurringBills.forEach((bill, index) => {
    const row = document.createElement('div');
    row.className = 'entry-item recurring';
    row.innerHTML = `<div class="entry-info"><div class="entry-category">${bill.category}</div><div class="entry-date">${bill.frequency.toUpperCase()} • Last paid: ${bill.lastPaid ? bill.lastPaid.slice(0, 10) : 'Never'}</div></div><div class="entry-amount">$${Number(bill.amount).toFixed(2)}</div>`;

    const actions = document.createElement('div');
    actions.className = 'entry-actions';

    const payBtn = document.createElement('button');
    payBtn.className = 'delete';
    payBtn.textContent = 'Pay';
    payBtn.onclick = () => payRecurring(index);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      state.recurringBills.splice(index, 1);
      persistActiveState();
      renderDashboard();
    };

    actions.appendChild(payBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(actions);
    recurringList.appendChild(row);
  });

  const incomeRecent = document.getElementById('incomeRecent');
  const expenseRecent = document.getElementById('expenseRecent');
  incomeRecent.innerHTML = '';
  expenseRecent.innerHTML = '';

  const recentIncome = state.income.filter(item => (new Date() - new Date(item.date)) / (1000 * 60 * 60 * 24) <= 14);
  const recentExpenses = state.expenses.filter(item => (new Date() - new Date(item.date)) / (1000 * 60 * 60 * 24) <= 14);

  if (!recentIncome.length) incomeRecent.innerHTML = '<div class="empty-state">No recent income</div>';
  recentIncome.forEach(item => {
    const row = document.createElement('div');
    row.className = 'entry-item';
    row.innerHTML = `<div class="entry-info"><div class="entry-category">${item.category}</div><div class="entry-date">${item.date.slice(0, 10)}</div></div><div class="entry-amount">$${Number(item.amount).toFixed(2)}</div>`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      const index = state.income.indexOf(item);
      if (index > -1) {
        state.income.splice(index, 1);
        persistActiveState();
        renderDashboard();
      }
    };

    row.appendChild(deleteBtn);
    incomeRecent.appendChild(row);
  });

  if (!recentExpenses.length) expenseRecent.innerHTML = '<div class="empty-state">No recent expenses</div>';
  recentExpenses.forEach(item => {
    const row = document.createElement('div');
    row.className = 'entry-item expense';
    row.innerHTML = `<div class="entry-info"><div class="entry-category">${item.category}</div><div class="entry-date">${item.date.slice(0, 10)}</div></div><div class="entry-amount">$${Number(item.amount).toFixed(2)}</div>`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      const index = state.expenses.indexOf(item);
      if (index > -1) {
        state.expenses.splice(index, 1);
        persistActiveState();
        renderDashboard();
      }
    };

    row.appendChild(deleteBtn);
    expenseRecent.appendChild(row);
  });

  renderTargetList();

  drawChart('incomeChart', Object.keys(t.incByCat), Object.values(t.incByCat));
  drawChart('expenseChart', Object.keys(t.expByCat), Object.values(t.expByCat));
}

function bindActionButtons() {
  const exportBtn = document.getElementById('exportCsvBtn');
  const reportBtn = document.getElementById('monthlyReportBtn');
  const reportPreview = document.getElementById('monthlyReportPreview');

  exportBtn.addEventListener('click', () => {
    if (!activeUser) return;
    exportCsv();
  });

  reportBtn.addEventListener('click', () => {
    if (!activeUser || !reportPreview) return;
    const report = buildMonthlyReport();
    reportPreview.style.display = 'block';
    reportPreview.textContent = report;
    downloadText(`monthly-report-${currentMonthKey()}.txt`, report);
  });
}

function bindAuthHandlers() {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const logoutBtn = document.getElementById('logoutBtn');

  loginForm.addEventListener('submit', event => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const error = loginAccount(formData.get('username'), formData.get('password'));
    if (error) {
      renderAuthError(error);
      return;
    }

    renderAuthError('');
    loginForm.reset();
    loadActiveState();
    renderDashboard();
  });

  registerForm.addEventListener('submit', event => {
    event.preventDefault();
    const formData = new FormData(registerForm);
    const error = registerAccount(formData.get('username'), formData.get('password'));
    if (error) {
      renderAuthError(error);
      return;
    }

    renderAuthError('');
    registerForm.reset();
    loadActiveState();
    renderDashboard();
  });

  logoutBtn.addEventListener('click', () => {
    logoutAccount();
    renderDashboard();
  });
}

function bindBudgetForms() {
  document.addEventListener('submit', event => {
    if (!activeUser) return;
    if (!['incomeForm', 'expenseForm', 'recurringForm', 'targetForm'].includes(event.target.id)) return;

    event.preventDefault();
    const cutoff = getCutoffDate();
    const formData = new FormData(event.target);

    if (event.target.id === 'incomeForm') {
      const amount = Number(formData.get('amount'));
      const category = String(formData.get('category') || '').trim();
      const date = formData.get('date') ? new Date(formData.get('date')).toISOString() : new Date().toISOString();
      if (!Number.isNaN(amount) && category && new Date(date) >= cutoff) {
        state.income.push({ amount, category, date });
        persistActiveState();
        renderDashboard();
        event.target.reset();
      }
    }

    if (event.target.id === 'expenseForm') {
      const amount = Number(formData.get('amount'));
      const category = String(formData.get('category') || '').trim();
      const date = formData.get('date') ? new Date(formData.get('date')).toISOString() : new Date().toISOString();
      if (!Number.isNaN(amount) && category && new Date(date) >= cutoff) {
        state.expenses.push({ amount, category, date });
        persistActiveState();
        renderDashboard();
        event.target.reset();
      }
    }

    if (event.target.id === 'recurringForm') {
      const amount = Number(formData.get('amount'));
      const category = String(formData.get('category') || '').trim();
      const frequency = String(formData.get('frequency') || '');
      const dateRaw = formData.get('date');
      const date = dateRaw ? new Date(dateRaw).toISOString() : '';

      if (!Number.isNaN(amount) && category && frequency && date && new Date(date) >= cutoff) {
        state.recurringBills.push({ amount, category, frequency, date, lastPaid: null });
        persistActiveState();
        renderDashboard();
        event.target.reset();
      }
    }

    if (event.target.id === 'targetForm') {
      const amount = Number(formData.get('amount'));
      const category = String(formData.get('category') || '').trim();
      const month = String(formData.get('month') || '').trim();

      if (!Number.isNaN(amount) && amount > 0 && category && month) {
        const existingTarget = state.targets.find(item => item.month === month && item.category === category);
        if (existingTarget) {
          existingTarget.amount = amount;
        } else {
          state.targets.push({ amount, category, month });
        }

        persistActiveState();
        renderDashboard();
        event.target.reset();
      }
    }
  });
}

function init() {
  loadAccounts();
  loadSession();
  loadActiveState();
  bindAuthHandlers();
  bindBudgetForms();
  bindActionButtons();
  renderDashboard();
}

init();