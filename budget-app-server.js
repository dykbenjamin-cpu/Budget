const ACCOUNTS_KEY = 'budgetAccounts_v1';
const SESSION_KEY = 'budgetSessionUser_v1';
const LEGACY_KEY = 'budgetAppData_v1';

let accounts = {};
let activeUser = null;
let state = { income: [], expenses: [], recurringBills: [] };
let charts = {};

function getCutoffDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 14, now.getDate());
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
      recurringBills: Array.isArray(parsed.recurringBills) ? parsed.recurringBills : []
    };
  } catch {
    return null;
  }
}

function ensureUserRecord(username) {
  if (!accounts[username]) {
    accounts[username] = { password: '', income: [], expenses: [], recurringBills: [] };
  }

  const cutoff = getCutoffDate();
  const user = accounts[username];
  user.income = (user.income || []).filter(i => new Date(i.date) >= cutoff);
  user.expenses = (user.expenses || []).filter(e => new Date(e.date) >= cutoff);
  user.recurringBills = user.recurringBills || [];
  return user;
}

function loadActiveState() {
  if (!activeUser) {
    state = { income: [], expenses: [], recurringBills: [] };
    return;
  }

  const user = ensureUserRecord(activeUser);
  state = {
    income: user.income,
    expenses: user.expenses,
    recurringBills: user.recurringBills
  };
}

function persistActiveState() {
  if (!activeUser) return;
  const user = ensureUserRecord(activeUser);
  user.income = state.income;
  user.expenses = state.expenses;
  user.recurringBills = state.recurringBills;
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

  accounts[username] = { password, income: [], expenses: [], recurringBills: [] };

  if (Object.keys(accounts).length === 1) {
    const legacy = getLegacyBudgetData();
    if (legacy) {
      accounts[username].income = legacy.income;
      accounts[username].expenses = legacy.expenses;
      accounts[username].recurringBills = legacy.recurringBills;
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
  state = { income: [], expenses: [], recurringBills: [] };
  Object.values(charts).forEach(chart => chart && chart.destroy && chart.destroy());
  charts = {};
}

function totals() {
  const incomeTotal = state.income.reduce((sum, item) => sum + Number(item.amount), 0);
  const expenseTotal = state.expenses.reduce((sum, item) => sum + Number(item.amount), 0);

  const incByCat = {};
  state.income.forEach(item => {
    incByCat[item.category] = (incByCat[item.category] || 0) + Number(item.amount);
  });

  const expByCat = {};
  state.expenses.forEach(item => {
    expByCat[item.category] = (expByCat[item.category] || 0) + Number(item.amount);
  });

  return {
    incomeTotal,
    expenseTotal,
    net: incomeTotal - expenseTotal,
    incByCat,
    expByCat
  };
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
  document.getElementById('incomeTotal').textContent = `$${t.incomeTotal.toFixed(2)}`;
  document.getElementById('expenseTotal').textContent = `$${t.expenseTotal.toFixed(2)}`;

  const netVal = document.getElementById('netVal');
  netVal.textContent = `${t.net < 0 ? '-' : ''}$${Math.abs(t.net).toFixed(2)}`;
  document.getElementById('netCard').classList.toggle('negative', t.net < 0);

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

  drawChart('incomeChart', Object.keys(t.incByCat), Object.values(t.incByCat));
  drawChart('expenseChart', Object.keys(t.expByCat), Object.values(t.expByCat));
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
    if (!['incomeForm', 'expenseForm', 'recurringForm'].includes(event.target.id)) return;

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
  });
}

function init() {
  loadAccounts();
  loadSession();
  loadActiveState();
  bindAuthHandlers();
  bindBudgetForms();
  renderDashboard();
}

init();