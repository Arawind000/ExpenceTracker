// common.js - shared storage + helpers (updated to emit 'stateChanged' events)
const STORAGE_KEY = 'expense_trk_v2';

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return {startingBalance:0,transactions:[],budgets:[]};
  try{ return JSON.parse(raw);} catch(e){ console.error('loadState parse error', e); return {startingBalance:0,transactions:[],budgets:[]}; }
}

// central save that emits an event so pages can react
function saveState(s){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  // dispatch a custom event on window to notify other scripts in same tab
  try {
    window.dispatchEvent(new CustomEvent('stateChanged', { detail: { timestamp: Date.now() } }));
  } catch(e) {
    // ignore
  }
}

function saveStartingBalance(v){ const s = loadState(); s.startingBalance = Number(v)||0; saveState(s); }

function calculateTotal(){
  const s = loadState();
  const start = Number(s.startingBalance||0);
  const sum = (s.transactions || []).reduce((acc,t)=> acc + (t.type==='income'?Number(t.amount):-Number(t.amount)), 0);
  return start + sum;
}

function formatCurrency(v){
  const num = Number(v) || 0;
  return '₹' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthSummary(){
  const s = loadState();
  const now = new Date();
  const key = now.toISOString().slice(0,7);
  let income=0, expense=0;
  (s.transactions || []).forEach(t=>{
    if(!t.date) return;
    if(t.date.slice(0,7)===key){
      if(t.type==='income') income += Number(t.amount) || 0;
      else expense += Number(t.amount) || 0;
    }
  });
  return { income, expense };
}

function addTransactionObj(tx){
  const s = loadState();
  tx.id = tx.id || ('tx_'+Math.random().toString(36).slice(2,9));
  s.transactions = s.transactions || [];
  s.transactions.push(tx);
  saveState(s);
}

function updateTransactionObj(id,patch){
  const s = loadState();
  s.transactions = s.transactions || [];
  const i = s.transactions.findIndex(t=>t.id===id);
  if(i>-1){ s.transactions[i] = {...s.transactions[i],...patch}; saveState(s); }
}

function deleteTransactionObj(id){
  const s = loadState();
  s.transactions = s.transactions || [];
  s.transactions = s.transactions.filter(t=>t.id!==id);
  saveState(s);
}

function saveBudgetObj(b){
  const s = loadState();
  s.budgets = s.budgets || [];
  const i = s.budgets.findIndex(x=>x.category===b.category);
  if(i>-1) s.budgets[i] = b;
  else s.budgets.push(b);
  saveState(s);
}

function deleteBudget(category){
  const s = loadState();
  s.budgets = s.budgets || [];
  s.budgets = s.budgets.filter(b=>b.category !== category);
  saveState(s);
}

function spentForCategoryThisMonth(category){
  const s = loadState();
  const key = new Date().toISOString().slice(0,7);
  return (s.transactions || []).reduce((acc,t)=> acc + ((t.category===category && t.type==='expense' && t.date && t.date.slice(0,7)===key) ? Number(t.amount) || 0 : 0), 0);
}

// expose
window.loadState = loadState;
window.saveState = saveState;
window.addTransactionObj = addTransactionObj;
window.updateTransactionObj = updateTransactionObj;
window.deleteTransactionObj = deleteTransactionObj;
window.saveBudgetObj = saveBudgetObj;
window.deleteBudget = deleteBudget;
window.formatCurrency = formatCurrency;
window.calculateTotal = calculateTotal;
window.saveStartingBalance = saveStartingBalance;
window.monthSummary = monthSummary;
window.spentForCategoryThisMonth = spentForCategoryThisMonth;

// reports.js - renders charts and re-renders when data changes
(function(){
    // wait for DOM + Chart.js loaded
    function ready(fn){
      if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
      else fn();
    }
  
    ready(() => {
      const pieEl = document.getElementById('pie');
      const barEl = document.getElementById('bar');
      if(!pieEl || !barEl){
        console.error('reports.js: missing canvas elements');
        return;
      }
  
      let pieChart = null;
      let barChart = null;
  
      function buildData(){
        const s = loadState();
        // pie: expense by category
        const expenses = (s.transactions || []).filter(t => t.type === 'expense');
        const sums = {};
        expenses.forEach(e => { sums[e.category || 'Uncategorized'] = (sums[e.category || 'Uncategorized']||0) + Number(e.amount || 0); });
        const pieLabels = Object.keys(sums);
        const pieData = Object.values(sums);
  
        // bar: last 6 months income vs expense
        const months = {};
        (s.transactions || []).forEach(t => {
          if(!t.date) return;
          const m = t.date.slice(0,7);
          months[m] = months[m] || {inc:0,exp:0};
          if(t.type==='income') months[m].inc += Number(t.amount||0);
          else months[m].exp += Number(t.amount||0);
        });
        const sortedKeys = Object.keys(months).sort();
        const lastKeys = sortedKeys.slice(Math.max(0, sortedKeys.length - 6));
        const inc = lastKeys.map(k => months[k].inc);
        const exp = lastKeys.map(k => months[k].exp);
  
        return { pieLabels, pieData, lastKeys, inc, exp };
      }
  
      function renderCharts(){
        const d = buildData();
  
        // destroy old
        if(pieChart) { pieChart.destroy(); pieChart = null; }
        if(barChart) { barChart.destroy(); barChart = null; }
  
        // Pie: handle empty gracefully
        const pieConfig = {
          type: 'doughnut',
          data: { labels: d.pieLabels.length?d.pieLabels:['No data'], datasets: [{ data: d.pieData.length?d.pieData:[1], backgroundColor: generatePalette( (d.pieData.length?d.pieData.length:1) ) }] },
          options: { responsive:true, plugins:{ legend:{ position:'right' } } }
        };
        pieChart = new Chart(pieEl, pieConfig);
  
        // Bar: if no months, show empty axis
        const barConfig = {
          type: 'bar',
          data: {
            labels: d.lastKeys.length?d.lastKeys:['No months'],
            datasets: [
              { label: 'Income', data: d.lastKeys.length?d.inc:[0], backgroundColor: '#60a5fa' },
              { label: 'Expenses', data: d.lastKeys.length?d.exp:[0], backgroundColor: '#ef4444' }
            ]
          },
          options: { responsive:true, scales:{ y: { beginAtZero:true } } }
        };
        barChart = new Chart(barEl, barConfig);
      }
  
      function generatePalette(n){
        const palette = ['#f97316','#f43f5e','#f59e0b','#60a5fa','#7c3aed','#10b981','#ef4444','#06b6d4','#f472b6','#a3e635'];
        const out = [];
        for(let i=0;i<n;i++) out.push(palette[i%palette.length]);
        return out;
      }
  
      // initial render
      renderCharts();
  
      // re-render when state changes in same tab
      window.addEventListener('stateChanged', () => { renderCharts(); });
  
      // also listen for storage events (other tabs)
      window.addEventListener('storage', (e) => {
        if(e.key === STORAGE_KEY || e.key === null) { renderCharts(); }
      });
    });
  })();
  // transactions.js - robust init: waits for common.js and DOM ready, with debug logs

(function(){
    const MAX_WAIT_MS = 3000;
  
    function waitForCommonApi(timeout = MAX_WAIT_MS){
      return new Promise((resolve, reject) => {
        const start = Date.now();
        function check(){
          if(window.loadState && window.addTransactionObj && window.deleteTransactionObj){
            console.log('transactions.js: common API available');
            return resolve();
          }
          if(Date.now() - start > timeout){
            return reject(new Error('transactions.js: timed out waiting for common API'));
          }
          setTimeout(check, 50);
        }
        check();
      });
    }
  
    function domReady(){
      return new Promise(resolve => {
        if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resolve);
        else resolve();
      });
    }
  
    async function init(){
      try{
        await waitForCommonApi();
        await domReady();
  
        console.log('transactions.js: initializing UI handlers');
  
        const amt = document.getElementById('amountInput');
        const date = document.getElementById('dateInput');
        const cat = document.getElementById('categoryInput');
        const note = document.getElementById('noteInput');
        const type = document.getElementById('typeSelect');
        const tableBody = document.querySelector('#txTable tbody');
        const addBtn = document.getElementById('addTx');
  
        if(!addBtn || !tableBody){
          console.error('transactions.js: required DOM nodes are missing. addBtn or tableBody not found.');
          return;
        }
  
        function render(){
          const s = loadState();
          const rows = (s.transactions || [])
            .slice()
            .sort((a,b)=> (b.date||'').localeCompare(a.date||''))
            .map(t => {
              const amountDisplay = t.type === 'income' ? formatCurrency(t.amount) : '-' + formatCurrency(t.amount);
              return `<tr data-id="${t.id}">
                <td>${t.date||''}</td>
                <td>${t.type}</td>
                <td>${escapeHtml(t.category||'')}</td>
                <td>${escapeHtml(t.notes||'')}</td>
                <td style="text-align:right">${amountDisplay}</td>
                <td style="white-space:nowrap">
                  <button class="btn btn-ghost btn-edit" data-id="${t.id}">Edit</button>
                  <button class="btn btn-ghost btn-delete" data-id="${t.id}">Delete</button>
                </td>
              </tr>`;
            }).join('');
          tableBody.innerHTML = rows;
          console.log('transactions.js: rendered', (s.transactions||[]).length, 'transactions');
        }
  
        // basic XSS escape
        function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m])); }
  
        // event delegation for table actions
        tableBody.addEventListener('click', (ev) => {
          const btn = ev.target.closest('button');
          if(!btn) return;
          const id = btn.getAttribute('data-id');
          if(!id) return;
          if(btn.classList.contains('btn-delete')){
            if(confirm('Delete this transaction?')){ deleteTransactionObj(id); render(); }
            return;
          }
          if(btn.classList.contains('btn-edit')){
            const s = loadState();
            const tx = (s.transactions||[]).find(x=>x.id === id);
            if(!tx){ alert('Transaction not found'); return; }
            const newAmt = prompt('Edit amount', tx.amount);
            if(newAmt === null) return;
            const newNote = prompt('Edit note (optional)', tx.notes || '');
            updateTransactionObj(id, { amount: Number(newAmt) || 0, notes: newNote || '' });
            render();
            return;
          }
        });
  
        // add button
        addBtn.addEventListener('click', () => {
          const v = Number(amt.value);
          if(!v){ alert('Enter amount'); if(amt) amt.focus(); return; }
          const tx = {
            type: (type && type.value) || 'expense',
            amount: v,
            date: (date && date.value) || new Date().toISOString().slice(0,10),
            category: (cat && cat.value) || 'Other',
            notes: (note && note.value) || ''
          };
          addTransactionObj(tx);
          // clear inputs
          if(amt) amt.value=''; if(cat) cat.value=''; if(note) note.value='';
          render();
          console.log('transactions.js: added transaction', tx);
        });
  
        // set default date if missing
        if(date && !date.value) date.value = new Date().toISOString().slice(0,10);
  
        // listen for state changes (other pages)
        window.addEventListener('stateChanged', () => { console.log('transactions.js: stateChanged received'); render(); });
        window.addEventListener('storage', (e) => { if(e.key === STORAGE_KEY || e.key === null) { console.log('transactions.js: storage event'); render(); } });
  
        render();
  
      }catch(err){
        console.error('transactions.js init error:', err);
      }
    }
  
    init();
  
  })();

  
  // budgets.js - robust init: waits for common.js and DOM ready, with debug logs

(function(){
    const MAX_WAIT_MS = 3000;
  
    function waitForCommonApi(timeout = MAX_WAIT_MS){
      return new Promise((resolve, reject) => {
        const start = Date.now();
        function check(){
          if(window.loadState && window.saveBudgetObj && window.deleteBudget){
            console.log('budgets.js: common API available');
            return resolve();
          }
          if(Date.now() - start > timeout) return reject(new Error('budgets.js: timed out waiting for common API'));
          setTimeout(check, 50);
        }
        check();
      });
    }
  
    function domReady(){
      return new Promise(resolve => {
        if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resolve);
        else resolve();
      });
    }
  
    async function init(){
      try{
        await waitForCommonApi();
        await domReady();
        console.log('budgets.js: initializing UI handlers');
  
        const catInput = document.getElementById('budgetCategory');
        const amtInput = document.getElementById('budgetAmount');
        const saveBtn = document.getElementById('saveBudget');
        const tableBody = document.querySelector('#budgetTable tbody');
  
        if(!saveBtn || !tableBody){
          console.error('budgets.js: required DOM nodes not found (saveBtn or tableBody)');
          return;
        }
  
        function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m])); }
  
        function render(){
          const s = loadState();
          const budgets = s.budgets || [];
          tableBody.innerHTML = budgets.map(b => {
            const spent = spentForCategoryThisMonth(b.category || '');
            return `<tr data-cat="${escapeHtml(b.category)}">
              <td>${escapeHtml(b.category)}</td>
              <td style="text-align:right">${formatCurrency(b.limit)}</td>
              <td style="text-align:right">${formatCurrency(spent)}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-ghost btn-delete-budget" data-cat="${escapeHtml(b.category)}">Delete</button>
              </td>
            </tr>`;
          }).join('');
          console.log('budgets.js: rendered', budgets.length, 'budgets');
        }
  
        tableBody.addEventListener('click', (ev) => {
          const btn = ev.target.closest('button');
          if(!btn) return;
          if(btn.classList.contains('btn-delete-budget')){
            const cat = btn.getAttribute('data-cat');
            if(!cat) return;
            if(confirm('Delete budget for "' + cat + '"?')){
              deleteBudget(cat);
              render();
              console.log('budgets.js: deleted budget for', cat);
            }
          }
        });
  
        saveBtn.addEventListener('click', () => {
          const category = (catInput.value || '').trim();
          const limit = Number(amtInput.value) || 0;
          if(!category){ alert('Enter category'); if(catInput) catInput.focus(); return; }
          saveBudgetObj({ category, limit });
          catInput.value=''; amtInput.value='';
          render();
          console.log('budgets.js: saved budget', {category, limit});
        });
  
        // listen for state updates
        window.addEventListener('stateChanged', () => { console.log('budgets.js: stateChanged received'); render(); });
        window.addEventListener('storage', (e) => { if(e.key === STORAGE_KEY || e.key === null) { console.log('budgets.js: storage event'); render(); } });
  
        render();
  
      }catch(err){
        console.error('budgets.js init error:', err);
      }
    }
  
    init();
  
  })();

  // reports.js - simple, focused reports UI and charts (re-renders on state change)
(function(){
  function ready(fn){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(() => {
    const pieEl = document.getElementById('pie');
    const barEl = document.getElementById('bar');
    const rpTotal = document.getElementById('rpTotal');
    const rpIncome = document.getElementById('rpIncome');
    const rpExpense = document.getElementById('rpExpense');
    const recentList = document.getElementById('recentList');

    if(!pieEl || !barEl || !rpTotal) {
      console.error('reports.js: missing DOM nodes');
      return;
    }

    let pieChart = null;
    let barChart = null;

    function build(){
      const s = loadState();

      // totals
      const total = calculateTotal();
      const month = monthSummary();

      // pie: expense by category
      const expenses = (s.transactions || []).filter(t => t.type === 'expense');
      const sums = {};
      expenses.forEach(e => { const key = e.category || 'Uncategorized'; sums[key] = (sums[key]||0) + Number(e.amount || 0); });

      const pieLabels = Object.keys(sums);
      const pieData = Object.values(sums);

      // bar: last 6 months
      const months = {};
      (s.transactions || []).forEach(t => {
        if(!t.date) return;
        const m = t.date.slice(0,7);
        months[m] = months[m] || {inc:0,exp:0};
        if(t.type === 'income') months[m].inc += Number(t.amount || 0);
        else months[m].exp += Number(t.amount || 0);
      });
      const sorted = Object.keys(months).sort();
      const last = sorted.slice(Math.max(0, sorted.length - 6));
      const inc = last.map(k => months[k].inc);
      const exp = last.map(k => months[k].exp);

      return { total, month, pieLabels, pieData, last, inc, exp, recent: (s.transactions||[]).slice(-6).reverse() };
    }

    function render(){
      const d = build();

      // update simple values
      rpTotal.textContent = formatCurrency(d.total);
      rpIncome.textContent = formatCurrency(d.month.income);
      rpExpense.textContent = formatCurrency(d.month.expense);

      // recent list
      if(d.recent.length === 0){
        recentList.innerHTML = '<div class="no-data">No transactions yet</div>';
      } else {
        recentList.innerHTML = d.recent.map(t => {
          const amt = t.type === 'income' ? formatCurrency(t.amount) : '-' + formatCurrency(t.amount);
          return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9"><div><div style="font-weight:600">${t.category||'--'}</div><div class="small">${t.date} • ${t.notes || ''}</div></div><div style="font-weight:700">${amt}</div></div>`;
        }).join('');
      }

      // pie chart
      if(pieChart) { pieChart.destroy(); pieChart = null; }
      const pieCfg = {
        type: 'doughnut',
        data: {
          labels: d.pieLabels.length ? d.pieLabels : ['No data'],
          datasets: [{ data: d.pieData.length ? d.pieData : [1], backgroundColor: palette(Math.max(d.pieData.length,1)) }]
        },
        options: { maintainAspectRatio:false, plugins:{legend:{position:'right'}} }
      };
      pieChart = new Chart(pieEl, pieCfg);

      // bar chart
      if(barChart) { barChart.destroy(); barChart = null; }
      const barCfg = {
        type: 'bar',
        data: {
          labels: d.last.length ? d.last : ['No months'],
          datasets: [
            { label:'Income', data: d.last.length ? d.inc : [0], backgroundColor:'#60a5fa' },
            { label:'Expenses', data: d.last.length ? d.exp : [0], backgroundColor:'#ef4444' }
          ]
        },
        options: { maintainAspectRatio:false, scales:{ y:{ beginAtZero:true } } }
      };
      barChart = new Chart(barEl, barCfg);
    }

    function palette(n){
      const p = ['#60a5fa','#f97316','#f43f5e','#a78bfa','#34d399','#fbbf24','#fb7185','#60c4b6'];
      const out = [];
      for(let i=0;i<n;i++) out.push(p[i%p.length]);
      return out;
    }

    // initial render & reactive updates
    render();
    window.addEventListener('stateChanged', render);
    window.addEventListener('storage', (e) => { if(e.key === STORAGE_KEY || e.key === null) render(); });

  });
})();
