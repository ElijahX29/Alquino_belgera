/* ═══════════════════════════════════════════
   DERMEDGE POS — script.js  (Supabase Edition v3)
   Inventory · Transactions · Customers · Reporting
═══════════════════════════════════════════ */
'use strict';

/* ══════════════════════════════════════════
   SUPABASE INIT
══════════════════════════════════════════ */
const SUPABASE_URL  = 'https://oqikzfevfjvuxvapwdbt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xaWt6ZmV2Zmp2dXh2YXB3ZGJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNzY4NTgsImV4cCI6MjA4Nzg1Mjg1OH0.Ilga21jT5MvBIXIi3ePvxAEtc6bQwaf4Zkpe_RHYSF0';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ══════════════════════════════════════════
   STATE
══════════════════════════════════════════ */
let state = {
  activePage:    'inventory',
  products:      [],
  customers:     [],
  transactions:  [],
  pos:           { cart: [], customer: null },
  notifications: [],
  settings: { taxRate:8, currency:'$', lowStock:10, storeName:'DERMEDGE Store' },
  invSort: { key:'name', dir:1 },
  filter:  { search:'' },
  _editingProduct:  null,
  _editingCustomer: null,
};

/* ══════════════════════════════════════════
   UTILS
══════════════════════════════════════════ */
const fmt      = n => `${state.settings.currency}${(+n).toFixed(2)}`;
const el       = id => document.getElementById(id);
const initials = name => name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
const esc      = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function skuSegment(value) {
  return String(value || 'Product')
    .replace(/[^a-z0-9 ]/gi, '')
    .trim()
    .split(/\s+/)
    .map(word => word[0])
    .join('')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X');
}

function generateProductSku(category = 'Skin Care Products') {
  const prefix = `DERM-${skuSegment(category)}`;
  const usedSkus = [
    ...state.products.map(p => p.sku),
    ...SERVICE_CATALOG.map(s => s.sku),
  ].filter(Boolean);
  const used = new Set(usedSkus.map(sku => String(sku).toUpperCase()));
  const next = usedSkus.reduce((max, sku) => {
    const match = String(sku).toUpperCase().match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0) + 1;

  let sequence = next;
  let sku = `${prefix}-${String(sequence).padStart(4, '0')}`;
  while (used.has(sku)) {
    sequence += 1;
    sku = `${prefix}-${String(sequence).padStart(4, '0')}`;
  }
  return sku;
}

const SERVICE_CATALOG = [
  { id:'svc-facial-basic', type:'service', name:'Signature Facial', cat:'Facial', sku:'SVC-FAC-001', price:120, stock:Infinity, variant:'60 min treatment' },
  { id:'svc-facial-deep', type:'service', name:'Deep Cleansing Facial', cat:'Facial', sku:'SVC-FAC-002', price:150, stock:Infinity, variant:'75 min treatment' },
  { id:'svc-body-contour', type:'service', name:'Body Treatment', cat:'Body Treatment', sku:'SVC-BDY-001', price:180, stock:Infinity, variant:'Body care session' },
  { id:'svc-laser-therapy', type:'service', name:'Epidermal Laser Therapy', cat:'Epidermal Laser Therapy', sku:'SVC-LSR-001', price:250, stock:Infinity, variant:'Specialist session' },
  { id:'svc-consultation', type:'service', name:'Skin Consultation', cat:'Other Services', sku:'SVC-OTH-001', price:50, stock:Infinity, variant:'Consultation' },
];

let _toastTimer;
function showToast(msg, type='info', ms=2200) {
  const t = el('toast');
  t.textContent = msg; t.className = `toast show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = filename; a.click();
}

/* ══════════════════════════════════════════
   SUPABASE DATA LOADERS
══════════════════════════════════════════ */

async function loadProducts() {
  const { data, error } = await db.from('products').select('*').order('name');
  if (error) { console.error('loadProducts:', error.message); return; }
  state.products = data.map(p => ({
    id:      p.id,
    name:    p.name,
    sku:     p.sku,
    cat:     p.category,
    price:   parseFloat(p.price),
    stock:   p.stock,
    variant: p.variant || 'Default',
    img:     p.img || '',
  }));
}

async function loadCustomers() {
  const { data, error } = await db.from('customers').select('*').order('name');
  if (error) { console.error('loadCustomers:', error.message); return; }
  state.customers = data.map(c => ({
    id:    c.id,
    name:  c.name,
    email: c.email  || '',
    phone: c.phone  || '',
    notes: c.notes  || '',
  }));
}

async function loadTransactions() {
  const { data, error } = await db
    .from('transactions')
    .select(`
      *,
      customer:customers ( id, name, email, phone ),
      items:transaction_items ( id, product_id, product_name, product_price, qty )
    `)
    .order('created_at', { ascending: false });

  if (error) { console.error('loadTransactions:', error.message); return; }

  state.transactions = (data || []).map(t => ({
    id:       t.id,
    customer: t.customer || null,
    method:   t.method,
    totals: {
      subtotal: parseFloat(t.subtotal),
      discount: parseFloat(t.discount || 0),
      tax:      parseFloat(t.tax),
      total:    parseFloat(t.total),
    },
    items: (t.items || []).map(i => ({
      product: hydrateSoldItem(i.product_id, i.product_name, i.product_price),
      qty: i.qty,
    })),
    timestamp: new Date(t.created_at).toLocaleString(),
    _ts:       new Date(t.created_at).getTime(),
  }));
}

function hydrateSoldItem(productId, name, price) {
  const product = state.products.find(p => p.id === productId);
  const service = SERVICE_CATALOG.find(s => s.id === productId || s.name === name);
  const source = product || service;
  return {
    id: productId || source?.id || null,
    name,
    price: parseFloat(price),
    cat: source?.cat || (productId ? 'Products' : 'Services'),
    type: product ? 'product' : 'service',
  };
}

async function loadNotifications() {
  const { data, error } = await db.from('notifications').select('*').order('created_at', { ascending: false }).limit(20);
  if (error) { console.error('loadNotifications:', error.message); return; }
  state.notifications = (data || []).map(n => ({
    id:     n.id,
    title:  n.title,
    body:   n.body,
    unread: n.unread,
    time:   timeAgo(new Date(n.created_at)),
  }));
}

function timeAgo(date) {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60)    return 'just now';
  if (sec < 3600)  return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`;
  return `${Math.floor(sec / 86400)} days ago`;
}

/* ══════════════════════════════════════════
   CLOCK
══════════════════════════════════════════ */
function updateClock() {
  const n = new Date();
  el('clockDate').textContent = n.toLocaleDateString('en-US', {weekday:'long', month:'short', day:'numeric'});
  el('clockTime').textContent = n.toLocaleTimeString('en-US', {hour12:false});
}
updateClock(); setInterval(updateClock, 1000);

/* ══════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════ */
function navigateTo(page) {
  state.activePage = page;
  state.filter.search = '';
  el('searchInput').value = '';
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== `page-${page}`));
  const placeholders = { inventory:'Search products…', transactions:'Search transactions…', customers:'Search customers…', reporting:'' };
  el('searchInput').placeholder = placeholders[page] || 'Search…';
  if (page==='inventory')    renderInventory();
  if (page==='pos')          renderPOS();
  if (page==='transactions') renderTransactions();
  if (page==='customers')    renderCustomers();
  if (page==='reporting')    renderReporting();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

el('searchInput').addEventListener('input', e => {
  state.filter.search = e.target.value;
  if (state.activePage==='inventory')    renderInventory();
  if (state.activePage==='pos')          renderPOS();
  if (state.activePage==='transactions') renderTransactions();
  if (state.activePage==='customers')    renderCustomers();
});
document.addEventListener('keydown', e => {
  if ((e.metaKey||e.ctrlKey) && e.key==='k') { e.preventDefault(); el('searchInput').focus(); el('searchInput').select(); }
});

/* ══════════════════════════════════════════
   LOADING OVERLAY
══════════════════════════════════════════ */
function setLoading(show) {
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(11,18,18,.82);display:flex;align-items:center;justify-content:center;z-index:9999;';
    overlay.innerHTML = `<div style="text-align:center;color:#66e3c4;font-family:'Space Mono',monospace;font-size:.8rem;letter-spacing:.1em">
      <div style="width:32px;height:32px;border:2px solid rgba(102,227,196,.2);border-top-color:#66e3c4;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 12px"></div>
      LOADING…
    </div>`;
    document.body.appendChild(overlay);
  }
  overlay.style.display = show ? 'flex' : 'none';
}

/* ══════════════════════════════════════════
   ████  INVENTORY  ████
══════════════════════════════════════════ */
function renderInventory() {
  const q   = (el('invSearch')?.value || state.filter.search).toLowerCase();
  const cat = el('invCatFilter')?.value || 'all';
  const stk = el('invStockFilter')?.value || 'all';
  const low = state.settings.lowStock;

  let rows = state.products.filter(p => {
    const qOk = !q || p.name.toLowerCase().includes(q) || String(p.sku || '').toLowerCase().includes(q);
    const cOk = cat==='all' || p.cat===cat;
    const sOk = stk==='all'
      || (stk==='out' && p.stock===0)
      || (stk==='low' && p.stock>0 && p.stock<low)
      || (stk==='in'  && p.stock>=low);
    return qOk && cOk && sOk;
  }).sort((a,b) => {
    const key = state.invSort.key;
    let av = key==='cat' ? a.cat : a[key];
    let bv = key==='cat' ? b.cat : b[key];
    if (typeof av==='string') { av=av.toLowerCase(); bv=bv.toLowerCase(); }
    return av<bv ? -state.invSort.dir : av>bv ? state.invSort.dir : 0;
  });

  const tbody = el('invBody'); if (!tbody) return;
  tbody.innerHTML = rows.length === 0
    ? `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--muted)">No products found</td></tr>`
    : rows.map(p => {
        const sl   = p.stock===0 ? 'out' : p.stock<low ? 'low' : 'in';
        const slbl = p.stock===0 ? 'Out of Stock' : p.stock<low ? 'Low Stock' : 'In Stock';
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:10px">
            <div class="tbl-img" style="background-image:url('${p.img}')"></div>
            <div><p class="tbl-name">${p.name}</p><p class="tbl-sub">${p.variant}</p></div>
          </div></td>
          <td>${p.cat}</td>
          <td><span class="mono-sm">${p.sku}</span></td>
          <td><span class="mono">${fmt(p.price)}</span></td>
          <td><span class="mono">${p.stock}</span></td>
          <td><span class="pill ${sl}">${slbl}</span></td>
          <td>
            <button class="tbl-btn inv-edit-btn" data-id="${p.id}">Edit</button>
            <button class="tbl-btn inv-adj-btn"  data-id="${p.id}">Adjust Stock</button>
            <button class="tbl-btn danger inv-del-btn" data-id="${p.id}">Delete</button>
          </td>
        </tr>`;
      }).join('');

  tbody.querySelectorAll('.inv-edit-btn').forEach(b => b.addEventListener('click', () => openInvEdit(b.dataset.id, false)));
  tbody.querySelectorAll('.inv-adj-btn').forEach(b  => b.addEventListener('click', () => openInvEdit(b.dataset.id, true)));
  tbody.querySelectorAll('.inv-del-btn').forEach(b  => b.addEventListener('click', () => deleteInventoryProduct(b.dataset.id)));

  document.querySelectorAll('[data-sort]').forEach(th => {
    th.style.cursor = 'pointer';
    th.onclick = () => {
      if (state.invSort.key===th.dataset.sort) state.invSort.dir *= -1;
      else { state.invSort.key=th.dataset.sort; state.invSort.dir=1; }
      renderInventory();
    };
  });
}

async function deleteInventoryProduct(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  if (!confirm(`Delete ${product.name} from inventory?`)) return;

  try {
    const { error } = await db.from('products').delete().eq('id', id);
    if (error) throw error;

    state.products = state.products.filter(p => p.id !== id);
    state.pos.cart = state.pos.cart.filter(item => !(item.type === 'product' && item.id === id));
    renderInventory();
    renderPOS();
    showToast(`${product.name} deleted`, 'success');
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error', 4200);
  }
}

['invSearch','invCatFilter','invStockFilter'].forEach(id => {
  el(id)?.addEventListener('input',  renderInventory);
  el(id)?.addEventListener('change', renderInventory);
});

el('invAddBtn')?.addEventListener('click', () => openInvEdit(null, false));

el('invExportBtn')?.addEventListener('click', () => {
  const rows = [['Name','SKU','Category','Price','Stock','Status'],
    ...state.products.map(p => [p.name, p.sku, p.cat, p.price, p.stock,
      p.stock===0 ? 'Out' : p.stock<state.settings.lowStock ? 'Low' : 'In Stock'])];
  downloadCSV('inventory.csv', rows);
  showToast('Inventory exported', 'success');
});

function openInvEdit(id, stockOnly) {
  const p    = id ? state.products.find(x => x.id===id) : null;
  const isNew = !p;
  const skuValue = isNew ? generateProductSku() : (p?.sku || generateProductSku(p?.cat));
  state._editingProduct = { id: p?.id || null, stockOnly };

  el('invEditTitle').textContent = isNew
    ? 'Add Product'
    : stockOnly ? `Adjust Stock — ${p.name}` : `Edit Product — ${p.name}`;

  el('invEditBody').innerHTML = stockOnly ? `
    <div class="form-group">
      <label class="form-label">Current Stock</label>
      <input class="form-input" value="${p.stock}" disabled/>
    </div>
    <div class="form-group">
      <label class="form-label">New Stock Quantity</label>
      <input class="form-input" id="fe_stock" type="number" min="0" value="${p.stock}"/>
    </div>
    <div class="form-group">
      <label class="form-label">Reason (optional)</label>
      <input class="form-input" id="fe_reason" placeholder="e.g. Restock, Damage, Correction"/>
    </div>
  ` : `
    <div class="form-group"><label class="form-label">Product Name</label><input class="form-input" id="fe_name" value="${p?.name||''}"/></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Category</label>
        <select class="form-input" id="fe_cat">
         ${['Skin Care Products', 'Hair Care', 'Body Lotion', 'Topical Cream','Fragrance'].map(c=>`<option${c===p?.cat?' selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">SKU</label>
        <div class="sku-field">
          <input class="form-input sku-input" id="fe_sku" value="${skuValue}" readonly/>
          ${isNew ? '<button class="icon-action-btn" id="fe_regen_sku" type="button" title="Regenerate SKU"><span class="material-symbols-outlined">autorenew</span></button>' : ''}
        </div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Price</label><input class="form-input" id="fe_price" type="number" min="0" step="0.01" value="${p?.price||0}"/></div>
      <div class="form-group"><label class="form-label">Stock</label><input class="form-input" id="fe_stock" type="number" min="0" value="${p?.stock||0}"/></div>
    </div>
    <div class="form-group"><label class="form-label">Variant / Description</label><input class="form-input" id="fe_variant" value="${p?.variant||'Default'}"/></div>
    <div class="form-group"><label class="form-label">Image URL (optional)</label><input class="form-input" id="fe_img" value="${p?.img||''}"/></div>
  `;
  if (!stockOnly && isNew) {
    el('fe_cat')?.addEventListener('change', e => {
      const skuInput = el('fe_sku');
      if (skuInput) skuInput.value = generateProductSku(e.target.value);
    });
    el('fe_regen_sku')?.addEventListener('click', () => {
      const skuInput = el('fe_sku');
      if (skuInput) skuInput.value = generateProductSku(el('fe_cat')?.value);
    });
  }
  openModal('invEditModal');
}

el('invEditSaveBtn').addEventListener('click', async () => {
  const { id, stockOnly } = state._editingProduct || {};
  const p = id ? state.products.find(x=>x.id===id) : null;
  const btn = el('invEditSaveBtn');
  btn.textContent = 'Saving…'; btn.disabled = true;

  try {
    if (stockOnly && p) {
      const newStock = Math.max(0, parseInt(el('fe_stock')?.value) || 0);
      const delta    = newStock - p.stock;
      const reason   = el('fe_reason')?.value || null;

      const { error } = await db.from('products').update({ stock: newStock }).eq('id', id);
      if (error) throw error;

      // Log the adjustment
      await db.from('stock_adjustments').insert({ product_id: id, delta, reason });

      p.stock = newStock;
      showToast(`Stock updated → ${newStock}`, 'success');

    } else {
      const payload = {
        name:     el('fe_name')?.value.trim()  || (p?.name || 'New Product'),
        category: el('fe_cat')?.value          || 'Skin Care Products',
        sku:      el('fe_sku')?.value.trim()   || generateProductSku(el('fe_cat')?.value),
        price:    parseFloat(el('fe_price')?.value) || 0,
        stock:    parseInt(el('fe_stock')?.value)   || 0,
        variant:  el('fe_variant')?.value      || 'Default',
        img:      el('fe_img')?.value.trim()   || '',
      };

      if (id) {
        const { error } = await db.from('products').update(payload).eq('id', id);
        if (error) throw error;
        Object.assign(p, { ...payload, cat: payload.category });
        showToast(`${payload.name} updated`, 'success');
      } else {
        const { data, error } = await db.from('products').insert(payload).select().single();
        if (error) throw error;
        state.products.push({ ...data, cat: data.category, price: parseFloat(data.price) });
        showToast(`${payload.name} added`, 'success');
      }
    }

    closeModal('invEditModal');
    renderInventory();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Save'; btn.disabled = false;
  }
});

/* ══════════════════════════════════════════
   ████  TRANSACTIONS  ████
══════════════════════════════════════════ */
/* POS / PURCHASE & SERVICES */
function getPOSItems() {
  const products = state.products.map(p => ({ ...p, type:'product' }));
  return [...products, ...SERVICE_CATALOG];
}

function renderPOS() {
  renderPOSCategories();
  renderPOSGrid();
  renderPOSCart();
  renderPOSCustomerSuggestions();
}

function renderPOSCategories() {
  const select = el('posCatFilter');
  if (!select) return;
  const current = select.value || 'all';
  const cats = [...new Set(getPOSItems().map(i => i.cat).filter(Boolean))].sort();
  select.innerHTML = `<option value="all">All Categories</option>` + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  select.value = cats.includes(current) ? current : 'all';
}

function renderPOSGrid() {
  const grid = el('posGrid');
  if (!grid) return;
  const q = (el('posSearch')?.value || state.filter.search || '').toLowerCase();
  const type = el('posTypeFilter')?.value || 'all';
  const cat = el('posCatFilter')?.value || 'all';
  const items = getPOSItems().filter(item => {
    const searchable = `${item.name} ${item.sku || ''} ${item.cat || ''} ${item.variant || ''}`.toLowerCase();
    return (!q || searchable.includes(q)) && (type === 'all' || item.type === type) && (cat === 'all' || item.cat === cat);
  });

  grid.innerHTML = items.length ? items.map(item => {
    const disabled = item.type === 'product' && item.stock <= 0;
    const stockText = item.type === 'service' ? 'Service' : `${item.stock} in stock`;
    return `<button class="pos-item-card${disabled ? ' disabled' : ''}" data-id="${esc(item.id)}" data-type="${item.type}" ${disabled ? 'disabled' : ''}>
      <span class="pos-item-type">${item.type === 'service' ? 'Service' : 'Product'}</span>
      <span class="pos-item-name">${esc(item.name)}</span>
      <span class="pos-item-meta">${esc(item.cat || '')}</span>
      <span class="pos-item-stock">${esc(stockText)}</span>
      <span class="pos-item-price">${fmt(item.price)}</span>
    </button>`;
  }).join('') : `<div class="empty-page pos-empty"><span class="material-symbols-outlined">search_off</span><p>No items found</p></div>`;

  grid.querySelectorAll('.pos-item-card').forEach(card => {
    card.addEventListener('click', () => addPOSItem(card.dataset.id, card.dataset.type));
  });
}

function addPOSItem(id, type) {
  const item = getPOSItems().find(x => x.id === id && x.type === type);
  if (!item) return;
  const existing = state.pos.cart.find(x => x.id === id && x.type === type);
  const nextQty = (existing?.qty || 0) + 1;
  if (type === 'product' && nextQty > item.stock) {
    showToast(`Only ${item.stock} available`, 'error');
    return;
  }
  if (existing) existing.qty = nextQty;
  else state.pos.cart.push({ id:item.id, type:item.type, name:item.name, cat:item.cat, sku:item.sku || '', price:item.price, qty:1 });
  renderPOSCart();
}

function updatePOSQty(id, type, delta) {
  const line = state.pos.cart.find(x => x.id === id && x.type === type);
  if (!line) return;
  const source = getPOSItems().find(x => x.id === id && x.type === type);
  const nextQty = line.qty + delta;
  if (nextQty <= 0) state.pos.cart = state.pos.cart.filter(x => !(x.id === id && x.type === type));
  else if (type === 'product' && source && nextQty > source.stock) showToast(`Only ${source.stock} available`, 'error');
  else line.qty = nextQty;
  renderPOSCart();
}

function getPOSTotals() {
  const subtotal = state.pos.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const tax = subtotal * ((parseFloat(state.settings.taxRate) || 0) / 100);
  return { subtotal, discount:0, tax, total:subtotal + tax };
}

function renderPOSCart() {
  const box = el('posCartItems');
  if (!box) return;
  box.innerHTML = state.pos.cart.length ? state.pos.cart.map(item => `
    <div class="pos-cart-item">
      <div class="pos-cart-info">
        <p class="pos-cart-name">${esc(item.name)}</p>
        <p class="pos-cart-sub">${esc(item.type)} - ${fmt(item.price)} each</p>
      </div>
      <div class="pos-qty-controls">
        <button class="qty-btn" data-action="dec" data-id="${esc(item.id)}" data-type="${item.type}">-</button>
        <span class="pos-qty">${item.qty}</span>
        <button class="qty-btn" data-action="inc" data-id="${esc(item.id)}" data-type="${item.type}">+</button>
      </div>
      <span class="pos-line-total">${fmt(item.price * item.qty)}</span>
    </div>`).join('') : `<div class="pos-cart-empty">Cart is empty</div>`;

  box.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => updatePOSQty(btn.dataset.id, btn.dataset.type, btn.dataset.action === 'inc' ? 1 : -1));
  });

  const totals = getPOSTotals();
  if (el('posTaxRate')) el('posTaxRate').textContent = state.settings.taxRate;
  if (el('posSubtotal')) el('posSubtotal').textContent = fmt(totals.subtotal);
  if (el('posTax')) el('posTax').textContent = fmt(totals.tax);
  if (el('posGrandTotal')) el('posGrandTotal').textContent = fmt(totals.total);
  const completeBtn = el('posCompleteBtn');
  if (completeBtn) completeBtn.disabled = state.pos.cart.length === 0;
}

function renderPOSCustomerSuggestions() {
  const input = el('posCustomerSearch');
  const box = el('posCustomerSuggestions');
  if (!input || !box) return;
  const q = input.value.trim().toLowerCase();
  if (state.pos.customer && !q) {
    box.innerHTML = `<div class="pos-selected-customer"><span>${esc(state.pos.customer.name)}</span><button type="button" id="posCustomerClear">Clear</button></div>`;
    el('posCustomerClear')?.addEventListener('click', () => {
      state.pos.customer = null;
      input.value = '';
      renderPOSCustomerSuggestions();
    });
    return;
  }
  if (!q) { box.innerHTML = ''; return; }
  const matches = state.customers.filter(c =>
    c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q)
  ).slice(0, 6);
  box.innerHTML = matches.length ? matches.map(c => `
    <button type="button" class="pos-suggestion-item" data-id="${esc(c.id)}">
      <span>${esc(c.name)}</span><small>${esc(c.phone || c.email || '')}</small>
    </button>`).join('') : `<div class="pos-suggestion-empty">No customer found</div>`;
  box.querySelectorAll('.pos-suggestion-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.pos.customer = state.customers.find(c => c.id === btn.dataset.id) || null;
      input.value = '';
      renderPOSCustomerSuggestions();
    });
  });
}

async function completePOSSale() {
  if (!state.pos.cart.length) { showToast('Add an item first', 'error'); return; }
  for (const item of state.pos.cart.filter(i => i.type === 'product')) {
    const product = state.products.find(p => p.id === item.id);
    if (!product || product.stock < item.qty) {
      showToast(`${item.name} does not have enough stock`, 'error');
      renderPOSGrid();
      return;
    }
  }

  const btn = el('posCompleteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Completing...'; }
  const totals = getPOSTotals();
  const method = el('posPaymentMethod')?.value || 'cash';
  let transactionId = null;

  try {
    const { data: txn, error: txnError } = await db.from('transactions').insert({
      customer_id: state.pos.customer?.id || null,
      method,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
    }).select().single();
    if (txnError) throw txnError;
    transactionId = txn.id;

    const itemRows = state.pos.cart.map(item => ({
      transaction_id: transactionId,
      product_id: item.type === 'product' ? item.id : null,
      product_name: item.name,
      product_price: item.price,
      qty: item.qty,
    }));
    const { error: itemsError } = await db.from('transaction_items').insert(itemRows);
    if (itemsError) throw itemsError;

    for (const item of state.pos.cart.filter(i => i.type === 'product')) {
      const product = state.products.find(p => p.id === item.id);
      const newStock = Math.max(0, product.stock - item.qty);
      const { error: stockError } = await db.from('products').update({ stock:newStock }).eq('id', item.id);
      if (stockError) throw stockError;
      product.stock = newStock;
    }

    const timestamp = new Date(txn.created_at || Date.now());
    state.transactions.unshift({
      id: transactionId,
      customer: state.pos.customer ? { ...state.pos.customer } : null,
      method,
      totals,
      items: state.pos.cart.map(item => ({ product:{ id:item.id, name:item.name, price:item.price, cat:item.cat, type:item.type }, qty:item.qty })),
      timestamp: timestamp.toLocaleString(),
      _ts: timestamp.getTime(),
    });
    state.pos.cart = [];
    state.pos.customer = null;
    if (el('posCustomerSearch')) el('posCustomerSearch').value = '';
    renderPOS();
    renderInventory();
    showToast('Sale completed', 'success');
    viewTransaction(transactionId);
  } catch (err) {
    if (transactionId) {
      await db.from('transaction_items').delete().eq('transaction_id', transactionId);
      await db.from('transactions').delete().eq('id', transactionId);
    }
    showToast('Checkout failed: ' + err.message, 'error', 4200);
  } finally {
    if (btn) { btn.disabled = state.pos.cart.length === 0; btn.textContent = 'Complete Sale'; }
  }
}

['posSearch','posTypeFilter','posCatFilter'].forEach(id => {
  el(id)?.addEventListener('input', renderPOSGrid);
  el(id)?.addEventListener('change', () => { renderPOSCategories(); renderPOSGrid(); });
});
el('posCustomerSearch')?.addEventListener('input', () => {
  state.pos.customer = null;
  renderPOSCustomerSuggestions();
});
el('posClearBtn')?.addEventListener('click', () => {
  state.pos.cart = [];
  renderPOSCart();
});
el('posCompleteBtn')?.addEventListener('click', completePOSSale);

function renderTransactions() {
  const q      = (el('txnSearch')?.value || state.filter.search).toLowerCase();
  const method = el('txnMethodFilter')?.value || 'all';
  const dateF  = el('txnDateFilter')?.value   || 'all';
  const svcF   = el('txnServiceFilter')?.value || 'all';
  const now    = Date.now();
  const DAY    = 86400000;

  const txns = state.transactions.filter(t => {
    const qOk = !q || t.id.toLowerCase().includes(q) || (t.customer?.name||'').toLowerCase().includes(q) || t.method.includes(q);
    const mOk = method==='all' || t.method===method;
    const age = now - t._ts;
    const dOk = dateF==='all' || (dateF==='today'&&age<DAY) || (dateF==='week'&&age<7*DAY) || (dateF==='month'&&age<30*DAY);
    const hasProduct = t.items.some(i => i.product.type === 'product');
    const serviceCats = t.items.filter(i => i.product.type === 'service').map(i => serviceFilterKey(i.product.cat));
    const sOk = svcF === 'all'
      || (svcF === 'product' && hasProduct)
      || serviceCats.includes(svcF)
      || (svcF === 'other' && serviceCats.length && serviceCats.every(c => !['facial','body_treatment','laser_therapy'].includes(c)));
    return qOk && mOk && dOk && sOk;
  });

  const statEl = el('txnStats');
  if (statEl) {
    const totalRev = txns.reduce((s,t)=>s+t.totals.total, 0);
    const avgOrder = txns.length ? totalRev/txns.length : 0;
    const totalTax = txns.reduce((s,t)=>s+t.totals.tax, 0);
    statEl.innerHTML = [
      { label:'Transactions', val:txns.length },
      { label:'Total Revenue', val:fmt(totalRev) },
      { label:'Avg Order',     val:fmt(avgOrder) },
      { label:'Tax Collected', val:fmt(totalTax) },
    ].map(s=>`<div class="txn-stat"><p class="txn-stat-label">${s.label}</p><p class="txn-stat-val">${s.val}</p></div>`).join('');
  }

  const tbody    = el('txnBody');
  const tableWrap= el('txnTableWrap');
  const emptyEl  = el('txnEmpty');
  if (!tbody) return;

  if (!txns.length) {
    if (tableWrap) tableWrap.style.display = 'none';
    if (emptyEl)   emptyEl.style.display   = 'flex';
    return;
  }
  if (tableWrap) tableWrap.style.display = '';
  if (emptyEl)   emptyEl.style.display   = 'none';

  tbody.innerHTML = txns.map(t => {
    const itemCount = t.items.reduce((s,i)=>s+i.qty, 0);
    const shortId   = t.id.slice(-8).toUpperCase();
    return `<tr>
      <td><span class="mono-sm">${shortId}</span></td>
      <td class="text-muted">${t.timestamp}</td>
      <td>${t.customer ? `<span class="tbl-name">${t.customer.name}</span>` : `<span class="text-muted">Walk-in</span>`}</td>
      <td>${itemCount} item${itemCount!==1?'s':''}</td>
      <td><span class="pill ${t.method}">${t.method}</span></td>
      <td><span class="mono">${fmt(t.totals.subtotal)}</span></td>
      <td><span class="mono text-muted">${fmt(t.totals.tax)}</span></td>
      <td><span class="mono bold">${fmt(t.totals.total)}</span></td>
      <td><button class="tbl-btn txn-view-btn" data-id="${t.id}">View</button></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.txn-view-btn').forEach(b => b.addEventListener('click', () => viewTransaction(b.dataset.id)));
}

function serviceFilterKey(cat) {
  const c = (cat || '').toLowerCase();
  if (c.includes('facial')) return 'facial';
  if (c.includes('body')) return 'body_treatment';
  if (c.includes('laser')) return 'laser_therapy';
  return 'other';
}

['txnSearch','txnMethodFilter','txnDateFilter','txnServiceFilter'].forEach(id => {
  el(id)?.addEventListener('input',  renderTransactions);
  el(id)?.addEventListener('change', renderTransactions);
});

function viewTransaction(id) {
  const txn = state.transactions.find(t=>t.id===id); if (!txn) return;
  const { subtotal, discount, tax, total } = txn.totals;
  const lines = [
    '══════════════════════════',
    `  ${state.settings.storeName}`,
    '      Transaction Record',
    `    ${txn.timestamp}`,
    '══════════════════════════',
    txn.customer ? `Customer: ${txn.customer.name}` : 'Walk-in Customer',
    '──────────────────────────',
    ...txn.items.map(({product:p,qty}) => `${p.name.padEnd(16).slice(0,16)} x${qty}  ${fmt(p.price*qty).padStart(7)}`),
    '──────────────────────────',
    `${'Subtotal'.padEnd(18)}${fmt(subtotal).padStart(8)}`,
    discount>0 ? `${'Discount'.padEnd(18)}${('-'+fmt(discount)).padStart(8)}` : null,
    `${'Tax ('+state.settings.taxRate+'%)'.padEnd(17)}${fmt(tax).padStart(8)}`,
    '══════════════════════════',
    `${'TOTAL'.padEnd(18)}${fmt(total).padStart(8)}`,
    '',
    `Payment Method: ${txn.method.toUpperCase()}`,
    '══════════════════════════',
    `TXN ID: ${txn.id.slice(-8).toUpperCase()}`,
  ].filter(l=>l!=null).join('\n');
  el('txnDetailContent').textContent = lines;
  openModal('txnDetailModal');
}

el('txnPrintBtn')?.addEventListener('click', () => window.print());

el('txnExportBtn')?.addEventListener('click', () => {
  const rows = [['TXN ID','Date','Customer','Items','Method','Subtotal','Tax','Total'],
    ...state.transactions.map(t => [t.id.slice(-8).toUpperCase(), t.timestamp, t.customer?.name||'Walk-in',
      t.items.reduce((s,i)=>s+i.qty,0), t.method, t.totals.subtotal.toFixed(2), t.totals.tax.toFixed(2), t.totals.total.toFixed(2)])];
  downloadCSV('transactions.csv', rows);
  showToast('Transactions exported','success');
});

/* ══════════════════════════════════════════
   ████  CUSTOMERS  ████
══════════════════════════════════════════ */
function renderCustomers() {
  const q    = (el('custSearch')?.value || state.filter.search).toLowerCase();
  const sort = el('custSortFilter')?.value || 'name';

  let list = state.customers.filter(c =>
    !q || c.name.toLowerCase().includes(q) || (c.email||'').toLowerCase().includes(q) || (c.phone||'').includes(q)
  ).map(c => {
    const txns  = state.transactions.filter(t=>t.customer?.id===c.id);
    const spent = txns.reduce((s,t)=>s+t.totals.total, 0);
    return { ...c, txnCount:txns.length, spent };
  }).sort((a,b) => {
    if (sort==='spent')  return b.spent - a.spent;
    if (sort==='orders') return b.txnCount - a.txnCount;
    return a.name.localeCompare(b.name);
  });

  const cards   = el('custCards');
  const emptyEl = el('custEmpty');
  if (!cards) return;

  if (!list.length) { cards.innerHTML=''; emptyEl?.classList.remove('hidden'); return; }
  emptyEl?.classList.add('hidden');

  cards.innerHTML = list.map(c => `
    <div class="customer-card" data-id="${c.id}">
      <div class="cust-card-top">
        <div class="cust-avatar-lg">${initials(c.name)}</div>
        <div>
          <p class="cust-card-name">${c.name}</p>
          <p class="cust-card-email">${c.email}</p>
        </div>
      </div>
      <div class="cust-card-stats">
        <div class="cust-stat"><span class="cust-stat-label">Orders</span><span class="cust-stat-val">${c.txnCount}</span></div>
        <div class="cust-stat"><span class="cust-stat-label">Total Spent</span><span class="cust-stat-val">${fmt(c.spent)}</span></div>
        <div class="cust-stat"><span class="cust-stat-label">Phone</span><span class="cust-stat-val" style="font-size:.72rem">${c.phone||'—'}</span></div>
      </div>
      ${c.notes ? `<p class="cust-notes">${c.notes}</p>` : ''}
      <div class="cust-card-actions">
        <button class="tbl-btn cust-edit-btn" data-id="${c.id}">Edit</button>
        <button class="tbl-btn cust-txn-btn"  data-id="${c.id}">View Orders</button>
        <button class="tbl-btn danger cust-del-btn" data-id="${c.id}">Delete</button>
      </div>
    </div>`).join('');

  cards.querySelectorAll('.cust-edit-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openCustomerEdit(b.dataset.id); }));
  cards.querySelectorAll('.cust-del-btn').forEach(b  => b.addEventListener('click', e => { e.stopPropagation(); deleteCustomer(b.dataset.id); }));
  cards.querySelectorAll('.cust-txn-btn').forEach(b  => b.addEventListener('click', e => {
    e.stopPropagation();
    const c = state.customers.find(x=>x.id===b.dataset.id); if (!c) return;
    navigateTo('transactions');
    setTimeout(() => { if (el('txnSearch')) { el('txnSearch').value=c.name; state.filter.search=c.name; renderTransactions(); } }, 50);
  }));
}

['custSearch','custSortFilter'].forEach(id => {
  el(id)?.addEventListener('input',  renderCustomers);
  el(id)?.addEventListener('change', renderCustomers);
});

el('custAddBtn')?.addEventListener('click', () => openNewCustomerForm());
el('custExportBtn')?.addEventListener('click', () => {
  const rows = [['Name','Email','Phone','Orders','Total Spent','Notes'],
    ...state.customers.map(c => {
      const txns  = state.transactions.filter(t=>t.customer?.id===c.id);
      const spent = txns.reduce((s,t)=>s+t.totals.total,0);
      return [c.name, c.email, c.phone, txns.length, spent.toFixed(2), c.notes||''];
    })];
  downloadCSV('customers.csv', rows);
  showToast('Customers exported','success');
});

function openNewCustomerForm() {
  state._editingCustomer = { id:null };
  el('custDetailTitle').textContent = 'New Customer';
  el('custDetailBody').innerHTML = customerFormHTML({name:'',email:'',phone:'',notes:''});
  el('custDeleteBtn').style.display = 'none';
  openModal('custDetailModal');
}

function openCustomerEdit(id) {
  const c = state.customers.find(x=>x.id===id); if (!c) return;
  state._editingCustomer = { id };
  el('custDetailTitle').textContent = `Edit — ${c.name}`;
  el('custDetailBody').innerHTML = customerFormHTML(c);
  el('custDeleteBtn').style.display = '';
  el('custDeleteBtn').onclick = () => { if (confirm(`Delete ${c.name}?`)) deleteCustomer(id); };
  openModal('custDetailModal');
}

function customerFormHTML(c) {
  return `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Full Name</label><input class="form-input" id="cf_name" value="${c.name}"/></div>
      <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="cf_phone" value="${c.phone||''}"/></div>
    </div>
    <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="cf_email" type="email" value="${c.email||''}"/></div>
    <div class="form-group"><label class="form-label">Notes</label><input class="form-input" id="cf_notes" value="${c.notes||''}"/></div>`;
}

el('custDetailSaveBtn')?.addEventListener('click', async () => {
  const name = (el('cf_name')?.value||'').trim();
  if (!name) { showToast('Name is required','error'); return; }
  const data = { name, phone:el('cf_phone')?.value||'', email:el('cf_email')?.value||'', notes:el('cf_notes')?.value||'' };
  const btn  = el('custDetailSaveBtn');
  btn.textContent = 'Saving…'; btn.disabled = true;

  try {
    if (state._editingCustomer?.id) {
      const { error } = await db.from('customers').update(data).eq('id', state._editingCustomer.id);
      if (error) throw error;
      Object.assign(state.customers.find(x=>x.id===state._editingCustomer.id), data);
      showToast(`${data.name} updated`,'success');
    } else {
      const { data: row, error } = await db.from('customers').insert(data).select().single();
      if (error) throw error;
      state.customers.push({ id: row.id, ...data });
      showToast(`${data.name} added`,'success');
    }
    closeModal('custDetailModal'); renderCustomers();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Save'; btn.disabled = false;
  }
});

async function deleteCustomer(id) {
  const c = state.customers.find(x=>x.id===id); if (!c) return;
  const { error } = await db.from('customers').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  state.customers = state.customers.filter(x=>x.id!==id);
  closeModal('custDetailModal'); renderCustomers();
  showToast(`${c.name} deleted`,'info');
}

/* ══════════════════════════════════════════
   ████  REPORTING  ████
══════════════════════════════════════════ */
function renderReporting() {
  const txns      = state.transactions;
  const PRODUCTS  = state.products;
  const totalRev  = txns.reduce((s,t)=>s+t.totals.total, 0);
  const totalTax  = txns.reduce((s,t)=>s+t.totals.tax, 0);
  const avgOrder  = txns.length ? totalRev/txns.length : 0;
  const itemsSold = txns.reduce((s,t)=>s+t.items.reduce((ss,i)=>ss+i.qty,0), 0);
  const uniqCust  = new Set(txns.filter(t=>t.customer).map(t=>t.customer.id)).size;
  const lowCount  = PRODUCTS.filter(p=>p.stock>0&&p.stock<state.settings.lowStock).length;
  const outCount  = PRODUCTS.filter(p=>p.stock===0).length;

  el('kpiGrid').innerHTML = [
    { icon:'💰', label:'Total Revenue',    val:fmt(totalRev)  },
    { icon:'🧾', label:'Transactions',     val:txns.length    },
    { icon:'📦', label:'Items Sold',       val:itemsSold      },
    { icon:'📊', label:'Avg Order Value',  val:fmt(avgOrder)  },
    { icon:'👥', label:'Unique Customers', val:uniqCust       },
    { icon:'🏷️', label:'Tax Collected',   val:fmt(totalTax)  },
    { icon:'⚠️', label:'Low Stock Items', val:lowCount, warn:lowCount>0 },
    { icon:'🚫', label:'Out of Stock',     val:outCount, warn:outCount>0 },
  ].map(k => `<div class="kpi-card${k.warn?' kpi-warn':''}">
    <div class="kpi-icon">${k.icon}</div>
    <p class="kpi-label">${k.label}</p>
    <p class="kpi-val${k.warn?' kpi-val-warn':''}">${k.val}</p>
  </div>`).join('');

  // Revenue by category
  const cats    = [...new Set([...PRODUCTS.map(p=>p.cat), ...SERVICE_CATALOG.map(s=>s.cat)])];
  const catRevs = {};
  txns.forEach(t => t.items.forEach(({product:p,qty}) => {
    const prod = PRODUCTS.find(x=>x.id===p.id);
    const cat  = p.cat || prod?.cat || 'Other';
    catRevs[cat] = (catRevs[cat]||0) + p.price*qty;
  }));
  const maxCat = Math.max(1, ...Object.values(catRevs));
  el('catChart').innerHTML = (cats.length ? cats : Object.keys(catRevs)).map(c => {
    const r = catRevs[c]||0;
    return `<div class="bar-row">
      <span class="bar-label">${c}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r/maxCat*100).toFixed(1)}%"></div></div>
      <span class="bar-val">${fmt(r)}</span>
    </div>`;
  }).join('') || `<p class="text-muted" style="font-size:.8rem;padding:8px 0">No data</p>`;

  // Payment methods donut
  const methods = { cash:0, card:0, split:0 };
  txns.forEach(t => { methods[t.method]=(methods[t.method]||0)+t.totals.total; });
  drawDonut(methods);

  // Top products and services
  const prodRev = {};
  txns.forEach(t => t.items.forEach(({product:p,qty}) => {
    prodRev[p.name] = prodRev[p.name] || { name:p.name, rev:0, qty:0 };
    prodRev[p.name].rev += p.price*qty;
    prodRev[p.name].qty += qty;
  }));
  const topList = Object.values(prodRev).sort((a,b)=>b.rev-a.rev).slice(0,5);
  el('topProducts').innerHTML = topList.length ? topList.map((p,i) => `
    <div class="top-product-row">
      <span class="top-rank">#${i+1}</span>
      <span class="top-name">${p.name}</span>
      <span class="top-qty text-muted">${p.qty} sold</span>
      <span class="top-rev">${fmt(p.rev)}</span>
    </div>`).join('') : `<p class="text-muted" style="font-size:.8rem;padding:8px 0">No sales data</p>`;

  drawLineChart(txns);

  // Export button (once per render)
  const repBtn = el('repExportBtn');
  if (repBtn) {
    repBtn.replaceWith(repBtn.cloneNode(true));
    el('repExportBtn').addEventListener('click', () => {
      const rows = [['Metric','Value'],
        ['Total Revenue',totalRev.toFixed(2)],['Transactions',txns.length],
        ['Items Sold',itemsSold],['Avg Order',avgOrder.toFixed(2)],
        ['Tax Collected',totalTax.toFixed(2)],['Unique Customers',uniqCust],
        ...Object.entries(catRevs).map(([c,r])=>['Revenue: '+c, r.toFixed(2)])];
      downloadCSV('report.csv', rows);
      showToast('Report exported','success');
    });
  }
}

function drawDonut(methods) {
  const canvas = el('donutCanvas'); if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  const total  = Object.values(methods).reduce((s,v)=>s+v, 0);
  const colors = { cash:'#52aff0', card:'#52d68a', split:'#f0a952' };
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  if (!total) {
    ctx.fillStyle='#244040'; ctx.beginPath(); ctx.arc(W/2,H/2,H/2-4,0,Math.PI*2); ctx.fill();
  } else {
    let start=0;
    Object.entries(methods).forEach(([m,v]) => {
      if (!v) return;
      const angle=(v/total)*Math.PI*2;
      ctx.beginPath(); ctx.moveTo(W/2,H/2);
      ctx.arc(W/2,H/2,H/2-4,start,start+angle);
      ctx.fillStyle=colors[m]||'#888'; ctx.fill();
      start+=angle;
    });
    ctx.beginPath(); ctx.arc(W/2,H/2,H/3,0,Math.PI*2);
    ctx.fillStyle='#152323'; ctx.fill();
    const totalLabel = fmt(total);
    ctx.fillStyle='#e8f4ef';
    ctx.font=`bold ${totalLabel.length > 10 ? 9 : 11}px "Space Mono",monospace`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(totalLabel, W/2, H/2);
  }
  el('donutLegend').innerHTML = Object.entries(methods).map(([m,v]) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${colors[m]||'#888'}"></span>
      <span class="legend-label">${m.charAt(0).toUpperCase()+m.slice(1)}</span>
      <span class="legend-val">${fmt(v)}</span>
    </div>`).join('');
}

function drawLineChart(txns) {
  const canvas  = el('lineCanvas');
  const emptyEl = el('lineEmpty');
  if (!canvas) return;
  if (!txns.length) { canvas.style.display='none'; if(emptyEl) emptyEl.style.display='flex'; return; }
  canvas.style.display=''; if(emptyEl) emptyEl.style.display='none';

  const sorted = [...txns].sort((a,b)=>a._ts-b._ts);
  const W = canvas.parentElement.offsetWidth || 700;
  const H = 180;
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  const vals  = sorted.map(t=>t.totals.total);
  const maxV  = Math.max(1,...vals);
  const pad   = 32;
  const xStep = vals.length>1 ? (W-pad*2)/(vals.length-1) : 0;

  ctx.strokeStyle='rgba(255,255,255,.04)'; ctx.lineWidth=1;
  for (let i=0;i<=4;i++) {
    const y=pad+(H-pad*2)*(i/4);
    ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(W-pad,y); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.2)'; ctx.font='10px "Space Mono"'; ctx.textAlign='right';
    ctx.fillText(fmt(maxV*(1-i/4)), pad-6, y+4);
  }

  const grad=ctx.createLinearGradient(0,pad,0,H-pad);
  grad.addColorStop(0,'rgba(102,227,196,.16)');
  grad.addColorStop(1,'rgba(102,227,196,0)');
  ctx.fillStyle=grad;
  ctx.beginPath(); ctx.moveTo(pad, H-pad-(vals[0]/maxV)*(H-pad*2));
  vals.forEach((v,i) => ctx.lineTo(pad+i*xStep, H-pad-(v/maxV)*(H-pad*2)));
  ctx.lineTo(pad+(vals.length-1)*xStep, H-pad); ctx.lineTo(pad, H-pad); ctx.closePath(); ctx.fill();

  ctx.strokeStyle='#66e3c4'; ctx.lineWidth=2; ctx.lineJoin='round';
  ctx.beginPath(); ctx.moveTo(pad, H-pad-(vals[0]/maxV)*(H-pad*2));
  vals.forEach((v,i) => ctx.lineTo(pad+i*xStep, H-pad-(v/maxV)*(H-pad*2)));
  ctx.stroke();

  vals.forEach((v,i) => {
    const x=pad+i*xStep, y=H-pad-(v/maxV)*(H-pad*2);
    ctx.beginPath(); ctx.arc(x,y,3.5,0,Math.PI*2);
    ctx.fillStyle='#66e3c4'; ctx.fill();
    if (i===0||i===vals.length-1||(vals.length<=6)) {
      ctx.fillStyle='rgba(102,227,196,.72)'; ctx.font='9px "Space Mono"'; ctx.textAlign='center';
      ctx.fillText(fmt(v), x, y-10);
    }
  });
}

/* ══════════════════════════════════════════
   NOTIFICATIONS
══════════════════════════════════════════ */
function updateNotifBadge() {
  const c = state.notifications.filter(n=>n.unread).length;
  const b = el('notifBadge');
  b.textContent = c||''; b.style.display = c?'':'none';
}

el('notifBtn').addEventListener('click', e => {
  e.stopPropagation();
  const p = el('notifPanel'); const open = p.style.display!=='none';
  p.style.display = open ? 'none' : 'flex';
  p.style.flexDirection = 'column';
  if (!open) renderNotifications();
});

function renderNotifications() {
  el('notifList').innerHTML = state.notifications.map(n => `
    <div class="notif-item${n.unread?' unread':''}" data-id="${n.id}">
      <p class="notif-title">${n.title}</p>
      <p class="notif-body">${n.body}</p>
      <p class="notif-time">${n.time}</p>
    </div>`).join('');
  el('notifList').querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', async () => {
      const n = state.notifications.find(x=>x.id===item.dataset.id);
      if (n && n.unread) {
        n.unread = false;
        item.classList.remove('unread');
        updateNotifBadge();
        await db.from('notifications').update({ unread: false }).eq('id', n.id);
      }
    });
  });
}

el('markAllRead').addEventListener('click', async () => {
  state.notifications.forEach(n=>n.unread=false);
  renderNotifications(); updateNotifBadge();
  await db.from('notifications').update({ unread: false }).eq('unread', true);
});

document.addEventListener('click', e => {
  if (!el('notifPanel').contains(e.target) && e.target!==el('notifBtn'))
    el('notifPanel').style.display='none';
});

/* ══════════════════════════════════════════
   SETTINGS (local — can extend to Supabase)
══════════════════════════════════════════ */
el('settingsBtn').addEventListener('click', () => {
  el('taxRateInput').value   = state.settings.taxRate;
  el('currencyInput').value  = state.settings.currency;
  el('lowStockInput').value  = state.settings.lowStock;
  el('storeNameInput').value = state.settings.storeName;
  openModal('settingsModal');
});

el('saveSettingsBtn').addEventListener('click', () => {
  state.settings.taxRate   = parseFloat(el('taxRateInput').value)  || 8;
  state.settings.currency  = el('currencyInput').value             || '$';
  state.settings.lowStock  = parseInt(el('lowStockInput').value)   || 10;
  state.settings.storeName = el('storeNameInput').value            || 'DERMEDGE Store';
  localStorage.setItem('dermedge_settings', JSON.stringify(state.settings));
  closeModal('settingsModal');
  showToast('Settings saved','success');
  renderInventory();
});

// Load persisted settings
const savedSettings = localStorage.getItem('dermedge_settings');
if (savedSettings) { try { Object.assign(state.settings, JSON.parse(savedSettings)); } catch(e){} }

/* ══════════════════════════════════════════
   SIGN OUT
══════════════════════════════════════════ */
el('clockOutBtn').addEventListener('click', async () => {
  if (!confirm('Sign out of the admin panel?')) return;
  await db.auth.signOut();
  document.body.style.transition = 'opacity .35s';
  document.body.style.opacity    = '0';
  setTimeout(() => { window.location.href = 'login.html'; }, 350);
});

/* ══════════════════════════════════════════
   MODAL HELPERS
══════════════════════════════════════════ */
function openModal(id)  { const m=el(id); if(m){m.style.display='flex';m.style.alignItems='center';m.style.justifyContent='center';} }
function closeModal(id) { const m=el(id); if(m)m.style.display='none'; }

document.addEventListener('click', e => {
  const cb = e.target.closest('.modal-close,[data-modal]');
  if (cb) { const id=cb.dataset.modal; if(id) closeModal(id); }
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});
document.addEventListener('keydown', e => {
  if (e.key==='Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => { if(m.style.display!=='none') closeModal(m.id); });
    el('notifPanel').style.display='none';
  }
});

/* ══════════════════════════════════════════
   AUTH GUARD + INIT
══════════════════════════════════════════ */
async function init() {
  // Guard: redirect to login if not authenticated
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  // Show logged-in user info in sidebar
  const user = session.user;
  const nameEl = document.querySelector('.user-name');
  const roleEl = document.querySelector('.user-role');
  const avatarEl = document.querySelector('.user-avatar');
  if (nameEl)   nameEl.textContent   = user.user_metadata?.full_name || user.email.split('@')[0];
  if (roleEl)   roleEl.textContent   = user.user_metadata?.role || 'Staff';
  if (avatarEl) avatarEl.textContent = (user.user_metadata?.full_name || user.email).slice(0,2).toUpperCase();

  // Load all data from Supabase
  setLoading(true);
  await Promise.all([loadProducts(), loadCustomers(), loadNotifications()]);
  await loadTransactions();
  setLoading(false);

  // Render initial page
  renderInventory();
  renderPOS();
  updateNotifBadge();
}

init();
