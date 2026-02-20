// Client-side budget app using localStorage
const STORAGE_KEY = 'budgetAppData_v1';
const now = new Date();
const cutoff = new Date(now.getFullYear(), now.getMonth() - 14, now.getDate());

let state = { income: [], expenses: [], recurringBills: [] };

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = JSON.parse(raw); } catch(e){ state = { income:[], expenses:[], recurringBills:[] }; }
  }
  // filter older than 14 months
  state.income = (state.income||[]).filter(i=>new Date(i.date)>=cutoff);
  state.expenses = (state.expenses||[]).filter(e=>new Date(e.date)>=cutoff);
}

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function totals() {
  const incomeTotal = (state.income||[]).reduce((s,i)=>s + Number(i.amount),0);
  const expenseTotal = (state.expenses||[]).reduce((s,e)=>s + Number(e.amount),0);
  const incByCat = {};
  (state.income||[]).forEach(i=> incByCat[i.category] = (incByCat[i.category]||0)+Number(i.amount));
  const expByCat = {};
  (state.expenses||[]).forEach(e=> expByCat[e.category] = (expByCat[e.category]||0)+Number(e.amount));
  return { incomeTotal, expenseTotal, net: incomeTotal - expenseTotal, incByCat, expByCat };
}

function applyRecurring() {
  const today = new Date();
  state.recurringBills.forEach(b=>{
    const lastPaid = b.lastPaid ? new Date(b.lastPaid) : null;
    const start = new Date(b.date);
    if (today < start) return;
    let should=false;
    if (b.frequency==='daily') should = !lastPaid || (today - lastPaid) >= 86400000;
    if (b.frequency==='weekly') should = !lastPaid || (today - lastPaid) >= 7*86400000;
    if (b.frequency==='monthly') should = !lastPaid || (today.getMonth() !== lastPaid.getMonth() || today.getFullYear() !== lastPaid.getFullYear());
    if (should) {
      // don't auto-push expenses repeatedly on page open; only update lastPaid.
      b.lastPaid = today.toISOString();
    }
  });
  save();
}

function render() {
  applyRecurring();
  const t = totals();
  document.getElementById('today').textContent = new Date().toISOString().slice(0,10);
  document.getElementById('incomeTotal').textContent = `$${t.incomeTotal.toFixed(2)}`;
  document.getElementById('expenseTotal').textContent = `$${t.expenseTotal.toFixed(2)}`;
  const netVal = document.getElementById('netVal'); netVal.textContent = `${t.net<0?'-':''}$${Math.abs(t.net).toFixed(2)}`;
  const netCard = document.getElementById('netCard'); netCard.classList.toggle('negative', t.net < 0);

  // Recurring list
  const recList = document.getElementById('recurringList'); recList.innerHTML='';
  if (!state.recurringBills.length) recList.innerHTML = '<div class="empty-state">No recurring bills yet</div>';
  state.recurringBills.forEach((b,i)=>{
    const el = document.createElement('div'); el.className='entry-item recurring';
    el.innerHTML = `<div class="entry-info"><div class="entry-category">${b.category}</div><div class="entry-date">${b.frequency.toUpperCase()} • Last paid: ${b.lastPaid?b.lastPaid.slice(0,10):'Never'}</div></div><div class="entry-amount">$${Number(b.amount).toFixed(2)}</div>`;
    const actions = document.createElement('div'); actions.className='entry-actions';
    const payBtn = document.createElement('button'); payBtn.className='delete'; payBtn.textContent='Pay'; payBtn.onclick = ()=>{ payRecurring(i); };
    const delBtn = document.createElement('button'); delBtn.className='delete'; delBtn.textContent='Delete'; delBtn.onclick=()=>{ state.recurringBills.splice(i,1); save(); render(); };
    actions.appendChild(payBtn); actions.appendChild(delBtn); el.appendChild(actions); recList.appendChild(el);
  });

  // Recent lists
  const incomeRecent = document.getElementById('incomeRecent'); incomeRecent.innerHTML='';
  const expRecent = document.getElementById('expenseRecent'); expRecent.innerHTML='';
  const recentIncome = state.income.filter(i=> (new Date()-new Date(i.date))/(1000*60*60*24) <=14 );
  const recentExp = state.expenses.filter(e=> (new Date()-new Date(e.date))/(1000*60*60*24) <=14 );
  if (!recentIncome.length) incomeRecent.innerHTML='<div class="empty-state">No recent income</div>';
  recentIncome.forEach((i,idx)=>{ const el=document.createElement('div'); el.className='entry-item'; el.innerHTML=`<div class="entry-info"><div class="entry-category">${i.category}</div><div class="entry-date">${i.date.slice(0,10)}</div></div><div class="entry-amount">$${Number(i.amount).toFixed(2)}</div>`; const del=document.createElement('button'); del.className='delete'; del.textContent='Delete'; del.onclick=()=>{ const idxAll=state.income.indexOf(i); if(idxAll>-1){ state.income.splice(idxAll,1); save(); render(); } }; el.appendChild(del); incomeRecent.appendChild(el); });
  if (!recentExp.length) expRecent.innerHTML='<div class="empty-state">No recent expenses</div>';
  recentExp.forEach((e,idx)=>{ const el=document.createElement('div'); el.className='entry-item expense'; el.innerHTML=`<div class="entry-info"><div class="entry-category">${e.category}</div><div class="entry-date">${e.date.slice(0,10)}</div></div><div class="entry-amount">$${Number(e.amount).toFixed(2)}</div>`; const del=document.createElement('button'); del.className='delete'; del.textContent='Delete'; del.onclick=()=>{ const idxAll=state.expenses.indexOf(e); if(idxAll>-1){ state.expenses.splice(idxAll,1); save(); render(); } }; el.appendChild(del); expRecent.appendChild(el); });

  // Charts
  drawChart('incomeChart', Object.keys(t.incByCat), Object.values(t.incByCat));
  drawChart('expenseChart', Object.keys(t.expByCat), Object.values(t.expByCat));
}

let charts = {};
function drawChart(elId, labels, data){
  const ctx = document.getElementById(elId).getContext('2d');
  if (charts[elId]) charts[elId].destroy();
  if (!labels.length){ ctx.font='16px Arial'; ctx.fillStyle='#999'; ctx.textAlign='center'; ctx.fillText('No data', ctx.canvas.width/2, ctx.canvas.height/2); return; }
  charts[elId] = new Chart(ctx, { type: 'doughnut', data: { labels, datasets:[{ data, backgroundColor: labels.map(l => l.includes('(Recurring)') ? 'rgba(255,159,64,0.8)' : 'rgba(54,162,235,0.8)') , borderColor:'white', borderWidth:2 }] }, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'},tooltip:{callbacks:{label: ctx => '$'+ctx.parsed.toFixed(2)}}}} });
}

function payRecurring(index){ const bill = state.recurringBills[index]; if (!bill) return; const dateStr = new Date().toISOString(); state.expenses.push({ amount: Number(bill.amount), category: bill.category, date: dateStr }); bill.lastPaid = dateStr; save(); render(); }

// Forms
document.addEventListener('submit', e=>{ e.preventDefault(); if (e.target.id==='incomeForm'){ const f=new FormData(e.target); const amount=Number(f.get('amount')); const category=f.get('category'); const date=f.get('date')?new Date(f.get('date')).toISOString():new Date().toISOString(); if (!isNaN(amount)&&category&&new Date(date)>=cutoff){ state.income.push({ amount, category, date }); save(); render(); e.target.reset(); } }
  if (e.target.id==='expenseForm'){ const f=new FormData(e.target); const amount=Number(f.get('amount')); const category=f.get('category'); const date=f.get('date')?new Date(f.get('date')).toISOString():new Date().toISOString(); if (!isNaN(amount)&&category&&new Date(date)>=cutoff){ state.expenses.push({ amount, category, date }); save(); render(); e.target.reset(); } }
  if (e.target.id==='recurringForm'){ const f=new FormData(e.target); const amount=Number(f.get('amount')); const category=f.get('category'); const frequency=f.get('frequency'); const date=new Date(f.get('date')).toISOString(); if(!isNaN(amount)&&category&&frequency&&new Date(date)>=cutoff){ state.recurringBills.push({ amount, category, frequency, date, lastPaid:null }); save(); render(); e.target.reset(); } }
});

// init
load(); render();
