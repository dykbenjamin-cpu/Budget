import http from "http";
import fs from "fs";
import { URL } from "url";

const DATA_FILE = "./data.json";

let income = [];
let expenses = [];
let recurringBills = [];

// 14-month cutoff
const now = new Date();
const cutoff = new Date(now.getFullYear(), now.getMonth() - 14, now.getDate());

// Load saved data and apply 14-month filter
if (fs.existsSync(DATA_FILE)) {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  income = (saved.income || []).filter(i => new Date(i.date) >= cutoff);
  expenses = (saved.expenses || []).filter(e => new Date(e.date) >= cutoff);
  recurringBills = saved.recurringBills || [];
}

function saveData() {
  // Remove any entries older than 14 months before saving
  income = income.filter(i => new Date(i.date) >= cutoff);
  expenses = expenses.filter(e => new Date(e.date) >= cutoff);
  fs.writeFileSync(DATA_FILE, JSON.stringify({ income, expenses, recurringBills }, null, 2));
}

function withinLast14Months(dateStr) {
  const d = new Date(dateStr);
  return d >= cutoff;
}

function totalsByCategory(entries, recurring=false) {
  const totals = {};
  for (const e of entries) {
    const key = recurring ? `${e.category} (Recurring)` : e.category;
    totals[key] = (totals[key] || 0) + e.amount;
  }
  return totals;
}

function totals() {
  const recentIncome = income.filter(i => withinLast14Months(i.date));
  const recentExpenses = expenses.filter(e => withinLast14Months(e.date));

  const incomeTotal = recentIncome.reduce((s, i) => s + i.amount, 0);
  const expenseTotal = recentExpenses.reduce((s, e) => s + e.amount, 0);

  return {
    incomeTotal,
    expenseTotal,
    net: incomeTotal - expenseTotal,
    incomeByCategory: totalsByCategory(recentIncome),
    expenseByCategory: totalsByCategory(recentExpenses, false)
  };
}

function applyRecurringBills() {
  const today = new Date();

  recurringBills.forEach(bill => {
    const lastPaidDate = bill.lastPaid ? new Date(bill.lastPaid) : null;
    const startDate = new Date(bill.date);
    let shouldApply = false;

    if (today < startDate) return;

    switch (bill.frequency) {
      case 'daily':
        if (!lastPaidDate || today - lastPaidDate >= 86400000) shouldApply = true;
        break;
      case 'weekly':
        if (!lastPaidDate || today - lastPaidDate >= 7 * 86400000) shouldApply = true;
        break;
      case 'monthly':
        if (!lastPaidDate || today.getMonth() !== lastPaidDate.getMonth() || today.getFullYear() !== lastPaidDate.getFullYear()) shouldApply = true;
        break;
    }

    if (shouldApply) {
      const dateStr = today.toISOString();
      bill.lastPaid = dateStr;
    }
  });
  saveData();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    applyRecurringBills();

    const t = totals();
    const incomeLabels = Object.keys(t.incomeByCategory);
    const incomeData = Object.values(t.incomeByCategory);
    const expenseLabels = Object.keys(t.expenseByCategory);
    const expenseData = Object.values(t.expenseByCategory);
    const expenseColors = Object.keys(t.expenseByCategory).map(label => label.includes('(Recurring)') ? 'rgba(255, 159, 64, 0.7)' : 'rgba(255, 99, 132, 0.7)');

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Budget Dashboard</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
          }
          
          .container {
            max-width: 1200px;
            margin: 0 auto;
          }
          
          .header {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            margin-bottom: 30px;
          }
          
          .header h1 {
            color: #333;
            font-size: 32px;
            margin-bottom: 15px;
          }
          
          .date-display {
            color: #666;
            font-size: 14px;
            margin-bottom: 20px;
          }
          
          .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
          }
          
          .summary-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
          }
          
          .summary-card.income {
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
          }
          
          .summary-card.expense {
            background: linear-gradient(135deg, #ee0979 0%, #ff6a00 100%);
          }
          
          .summary-card.net {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          
          .summary-card.net.negative {
            background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%);
          }
          
          .summary-label {
            font-size: 12px;
            opacity: 0.9;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
          }
          
          .summary-value {
            font-size: 28px;
            font-weight: bold;
          }
          
          .main-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 30px;
          }
          
          @media (max-width: 768px) {
            .main-grid {
              grid-template-columns: 1fr;
            }
          }
          
          .card {
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            padding: 25px;
          }
          
          .card h2 {
            color: #333;
            font-size: 20px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          
          .form-group {
            margin-bottom: 15px;
          }
          
          .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }
          
          .form-row.full {
            grid-template-columns: 1fr;
          }
          
          label {
            display: block;
            font-size: 12px;
            color: #666;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
          }
          
          input, select {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 6px;
            font-size: 14px;
            transition: all 0.3s ease;
            font-family: inherit;
          }
          
          input:focus, select:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
          }
          
          button {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(102, 126, 234, 0.3);
          }
          
          button.delete {
            background: linear-gradient(135deg, #ee0979 0%, #ff6a00 100%);
            padding: 6px 12px;
            font-size: 12px;
            width: auto;
            margin-top: 5px;
          }
          
          .entries-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          
          .entry-item {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-left: 4px solid #667eea;
            transition: all 0.3s ease;
          }
          
          .entry-item:hover {
            background: #f0f1ff;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          }
          
          .entry-item.expense {
            border-left-color: #ee0979;
          }
          
          .entry-item.recurring {
            border-left-color: #11998e;
          }
          
          .entry-info {
            flex: 1;
          }
          
          .entry-date {
            font-size: 12px;
            color: #999;
          }
          
          .entry-category {
            font-weight: 600;
            color: #333;
          }
          
          .entry-amount {
            font-size: 18px;
            font-weight: bold;
            color: #667eea;
            margin-right: 15px;
          }
          
          .entry-item.expense .entry-amount {
            color: #ee0979;
          }
          
          .entry-item.recurring .entry-amount {
            color: #11998e;
          }
          
          .entry-actions {
            display: flex;
            gap: 8px;
          }
          
          .empty-state {
            text-align: center;
            color: #999;
            padding: 30px;
            font-size: 14px;
          }
          
          .charts-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 30px;
          }
          
          @media (max-width: 768px) {
            .charts-grid {
              grid-template-columns: 1fr;
            }
          }
          
          .chart-container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            padding: 25px;
            position: relative;
            height: 400px;
          }
          
          .chart-container h3 {
            color: #333;
            font-size: 18px;
            margin-bottom: 20px;
          }
          
          .chart-wrapper {
            position: relative;
            height: 320px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💰 Budget Dashboard</h1>
            <div class="date-display">Last 14 Months | Today: ${new Date().toISOString().slice(0,10)}</div>
            <div class="summary-grid">
              <div class="summary-card income">
                <div class="summary-label">Total Income</div>
                <div class="summary-value">$${t.incomeTotal.toFixed(2)}</div>
              </div>
              <div class="summary-card expense">
                <div class="summary-label">Total Expenses</div>
                <div class="summary-value">$${t.expenseTotal.toFixed(2)}</div>
              </div>
              <div class="summary-card ${t.net < 0 ? 'negative' : 'net'}">
                <div class="summary-label">Net Balance</div>
                <div class="summary-value">${t.net < 0 ? '-' : ''}$${Math.abs(t.net).toFixed(2)}</div>
              </div>
            </div>
          </div>
          
          <div class="main-grid">
            <div class="card">
              <h2>➕ Add Income</h2>
              <form method="POST" action="/income">
                <div class="form-group">
                  <label>Category</label>
                  <input name="category" placeholder="e.g., Salary, Freelance" required />
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Amount</label>
                    <input name="amount" type="number" step="0.01" placeholder="0.00" required />
                  </div>
                  <div class="form-group">
                    <label>Date</label>
                    <input name="date" type="date" />
                  </div>
                </div>
                <button>Add Income</button>
              </form>
            </div>
            
            <div class="card">
              <h2>➖ Add Expense</h2>
              <form method="POST" action="/expense">
                <div class="form-group">
                  <label>Category</label>
                  <input name="category" placeholder="e.g., Groceries, Rent" required />
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Amount</label>
                    <input name="amount" type="number" step="0.01" placeholder="0.00" required />
                  </div>
                  <div class="form-group">
                    <label>Date</label>
                    <input name="date" type="date" />
                  </div>
                </div>
                <button>Add Expense</button>
              </form>
            </div>
          </div>
          
          <div class="main-grid">
            <div class="card">
              <h2>🔄 Add Recurring Bill</h2>
              <form method="POST" action="/recurring">
                <div class="form-group">
                  <label>Category</label>
                  <input name="category" placeholder="e.g., Netflix, Gym" required />
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Amount</label>
                    <input name="amount" type="number" step="0.01" placeholder="0.00" required />
                  </div>
                  <div class="form-group">
                    <label>Frequency</label>
                    <select name="frequency" required>
                      <option value="">Select Frequency</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
                <div class="form-group form-row full">
                  <label>Start Date</label>
                  <input name="date" type="date" required />
                </div>
                <button>Add Recurring Bill</button>
              </form>
            </div>
            
            <div class="card">
              <h2>📋 Recurring Bills</h2>
              <div class="entries-list">
                ${recurringBills.length === 0 ? '<div class="empty-state">No recurring bills yet</div>' : recurringBills.map((b, i) => 
                  '<div class="entry-item recurring">' +
                    '<div class="entry-info">' +
                      '<div class="entry-category">' + b.category + '</div>' +
                      '<div class="entry-date">' + b.frequency.toUpperCase() + ' • Last paid: ' + (b.lastPaid ? b.lastPaid.slice(0,10) : 'Never') + '</div>' +
                    '</div>' +
                    '<div class="entry-amount">$' + b.amount.toFixed(2) + '</div>' +
                    '<div class="entry-actions">' +
                      '<form style="display:inline" method="POST" action="/pay-recurring">' +
                        '<input type="hidden" name="index" value="' + i + '" />' +
                        '<button class="delete" type="submit">Pay</button>' +
                      '</form>' +
                      '<form style="display:inline" method="POST" action="/delete-recurring">' +
                        '<input type="hidden" name="index" value="' + i + '" />' +
                        '<button class="delete" type="submit">Delete</button>' +
                      '</form>' +
                    '</div>' +
                  '</div>'
                ).join('')}
              </div>
            </div>
          </div>
          
          <div class="charts-grid">
            <div class="chart-container">
              <h3>📈 Income by Category</h3>
              <div class="chart-wrapper">
                <canvas id="incomeChart"></canvas>
              </div>
            </div>
            
            <div class="chart-container">
              <h3>📉 Expenses by Category</h3>
              <div class="chart-wrapper">
                <canvas id="expenseChart"></canvas>
              </div>
            </div>
          </div>
          
          <div class="main-grid">
            <div class="card">
              <h2>💵 Recent Income (Last 14 Days)</h2>
              <div class="entries-list">
                ${income.filter(i => {
                  const d = new Date(i.date);
                  return (new Date() - d) / (1000*60*60*24) <= 14;
                }).length === 0 ? '<div class="empty-state">No recent income</div>' : income.filter(i => {
                  const d = new Date(i.date);
                  return (new Date() - d) / (1000*60*60*24) <= 14;
                }).map((i, idx) => 
                  '<div class="entry-item">' +
                    '<div class="entry-info">' +
                      '<div class="entry-category">' + i.category + '</div>' +
                      '<div class="entry-date">' + i.date.slice(0,10) + '</div>' +
                    '</div>' +
                    '<div class="entry-amount">$' + i.amount.toFixed(2) + '</div>' +
                    '<form style="display:inline" method="POST" action="/delete-income">' +
                      '<input type="hidden" name="index" value="' + idx + '" />' +
                      '<button class="delete" type="submit">Delete</button>' +
                    '</form>' +
                  '</div>'
                ).join('')}
              </div>
            </div>
            
            <div class="card">
              <h2>💸 Recent Expenses (Last 14 Days)</h2>
              <div class="entries-list">
                ${expenses.filter(e => {
                  const d = new Date(e.date);
                  return (new Date() - d) / (1000*60*60*24) <= 14;
                }).length === 0 ? '<div class="empty-state">No recent expenses</div>' : expenses.filter(e => {
                  const d = new Date(e.date);
                  return (new Date() - d) / (1000*60*60*24) <= 14;
                }).map((e, idx) => 
                  '<div class="entry-item expense">' +
                    '<div class="entry-info">' +
                      '<div class="entry-category">' + e.category + '</div>' +
                      '<div class="entry-date">' + e.date.slice(0,10) + '</div>' +
                    '</div>' +
                    '<div class="entry-amount">$' + e.amount.toFixed(2) + '</div>' +
                    '<form style="display:inline" method="POST" action="/delete-expense">' +
                      '<input type="hidden" name="index" value="' + idx + '" />' +
                      '<button class="delete" type="submit">Delete</button>' +
                    '</form>' +
                  '</div>'
                ).join('')}
              </div>
            </div>
          </div>
        </div>
        
        <script>
          const incomeCtx = document.getElementById('incomeChart').getContext('2d');
          ${incomeLabels.length > 0 ? 'new Chart(incomeCtx, {type: "doughnut", data: {labels: ' + JSON.stringify(incomeLabels) + ', datasets: [{data: ' + JSON.stringify(incomeData) + ', backgroundColor: ["rgba(76, 192, 192, 0.8)", "rgba(54, 162, 235, 0.8)", "rgba(153, 102, 255, 0.8)", "rgba(201, 203, 207, 0.8)", "rgba(255, 159, 64, 0.8)", "rgba(255, 99, 132, 0.8)"], borderColor: "white", borderWidth: 2}]}, options: {responsive: true, maintainAspectRatio: false, plugins: {legend: {position: "bottom"}, tooltip: {callbacks: {label: ctx => "$" + ctx.parsed.toFixed(2)}}}}});' : 'incomeCtx.font = "16px Arial"; incomeCtx.fillStyle = "#999"; incomeCtx.textAlign = "center"; incomeCtx.fillText("No data", incomeCtx.canvas.width / 2, incomeCtx.canvas.height / 2);'}

          const expenseCtx = document.getElementById('expenseChart').getContext('2d');
          ${expenseLabels.length > 0 ? 'new Chart(expenseCtx, {type: "doughnut", data: {labels: ' + JSON.stringify(expenseLabels) + ', datasets: [{data: ' + JSON.stringify(expenseData) + ', backgroundColor: ["rgba(255, 99, 132, 0.8)", "rgba(255, 159, 64, 0.8)", "rgba(255, 205, 86, 0.8)", "rgba(201, 203, 207, 0.8)", "rgba(54, 162, 235, 0.8)", "rgba(153, 102, 255, 0.8)"], borderColor: "white", borderWidth: 2}]}, options: {responsive: true, maintainAspectRatio: false, plugins: {legend: {position: "bottom"}, tooltip: {callbacks: {label: ctx => "$" + ctx.parsed.toFixed(2)}}}}});' : 'expenseCtx.font = "16px Arial"; expenseCtx.fillStyle = "#999"; expenseCtx.textAlign = "center"; expenseCtx.fillText("No data", expenseCtx.canvas.width / 2, expenseCtx.canvas.height / 2);'}
        </script>
      </body>
      </html>
    `);
    return;
  }

  function parseBody(req, callback) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => callback(new URLSearchParams(body)));
  }

  if (req.method === 'POST') {
    if (url.pathname === '/income') {
      parseBody(req, p => {
        const amount = Number(p.get('amount'));
        const category = p.get('category');
        const date = p.get('date') ? new Date(p.get('date')).toISOString() : new Date().toISOString();
        if (!isNaN(amount) && category && new Date(date) >= cutoff) { income.push({amount, category, date}); saveData(); }
        res.writeHead(302, {Location: '/'}); res.end();
      }); return;
    }
    if (url.pathname === '/expense') {
      parseBody(req, p => {
        const amount = Number(p.get('amount'));
        const category = p.get('category');
        const date = p.get('date') ? new Date(p.get('date')).toISOString() : new Date().toISOString();
        if (!isNaN(amount) && category && new Date(date) >= cutoff) { expenses.push({amount, category, date}); saveData(); }
        res.writeHead(302, {Location: '/'}); res.end();
      }); return;
    }
    if (url.pathname === '/recurring') {
      parseBody(req, p => {
        const amount = Number(p.get('amount'));
        const category = p.get('category');
        const frequency = p.get('frequency');
        const date = new Date(p.get('date')).toISOString();
        if (!isNaN(amount) && category && frequency && new Date(date) >= cutoff) {
          recurringBills.push({ amount, category, frequency, date, lastPaid: null });
          saveData();
        }
        res.writeHead(302, { Location: '/' }); res.end();
      }); return;
    }
    if (url.pathname === '/pay-recurring') {
      parseBody(req, p => {
        const index = Number(p.get('index'));
        const bill = recurringBills[index];
        if (bill) {
          const dateStr = new Date().toISOString();
          if (new Date(dateStr) >= cutoff) { expenses.push({amount: bill.amount, category: bill.category, date: dateStr}); }
          bill.lastPaid = dateStr; saveData();
        }
        res.writeHead(302, {Location: '/'}); res.end();
      }); return;
    }
    if (url.pathname === '/delete-income') { parseBody(req, p => { const index = Number(p.get('index')); if (!isNaN(index) && income[index]) { income.splice(index,1); saveData(); } res.writeHead(302, {Location:'/'}); res.end(); }); return; }
    if (url.pathname === '/delete-expense') { parseBody(req, p => { const index = Number(p.get('index')); if (!isNaN(index) && expenses[index]) { expenses.splice(index,1); saveData(); } res.writeHead(302, {Location:'/'}); res.end(); }); return; }
    if (url.pathname === '/delete-recurring') { parseBody(req, p => { const index = Number(p.get('index')); if (!isNaN(index) && recurringBills[index]) { recurringBills.splice(index,1); saveData(); } res.writeHead(302, {Location:'/'}); res.end(); }); return; }

    res.writeHead(404); res.end('Not found');
  }
});

server.listen(3000, () => console.log('Budget App running at http://localhost:3000'));
