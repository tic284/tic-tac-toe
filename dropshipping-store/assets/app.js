/* Dastak storefront logic */
(() => {
  'use strict';

  const CART_KEY = 'dastak-cart-v1';
  const ORDERS_KEY = 'dastak-orders-v1';
  const FREE_SHIP = 3000;
  const SHIP_FEE = 199;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const money = (n) => 'Rs ' + Number(n).toLocaleString('en-PK');
  const productById = (id) => PRODUCTS.find((p) => p.id === id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const state = { q: '', cat: 'All', sort: 'featured' };
  let cart = loadCart();
  let modalQty = 1;
  let lastFocus = null;

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((i) => i && productById(i.id) && Number.isFinite(i.qty) && i.qty > 0)
        .map((i) => ({ id: i.id, qty: Math.min(10, Math.round(i.qty)) }));
    } catch (err) {
      return [];
    }
  }

  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (err) { /* ignore */ }
  }

  function totals() {
    const subtotal = cart.reduce((sum, item) => {
      const p = productById(item.id);
      return sum + (p ? p.price * item.qty : 0);
    }, 0);
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    const delivery = subtotal === 0 ? 0 : (subtotal >= FREE_SHIP ? 0 : SHIP_FEE);
    return { subtotal, delivery, total: subtotal + delivery, count };
  }

  /* ---------- Catalog ---------- */

  function buildChips() {
    const cats = [...new Set(PRODUCTS.map((p) => p.cat))];
    const all = [['All', PRODUCTS.length]].concat(
      cats.map((c) => [c, PRODUCTS.filter((p) => p.cat === c).length])
    );
    $('#chips').innerHTML = all.map(([name, n]) =>
      `<button class="chip" type="button" data-cat="${esc(name)}" aria-pressed="${name === state.cat}">` +
      `${esc(name)}<span class="chip-count">${n}</span></button>`
    ).join('');
  }

  function visibleProducts() {
    const q = state.q.toLowerCase();
    let list = PRODUCTS.filter((p) => {
      if (state.cat !== 'All' && p.cat !== state.cat) return false;
      if (!q) return true;
      const hay = `${p.name} ${p.cat} ${p.desc} ${p.features.join(' ')}`.toLowerCase();
      return q.split(/\s+/).every((word) => hay.includes(word));
    });
    if (state.sort === 'price-asc') list = list.slice().sort((a, b) => a.price - b.price);
    if (state.sort === 'price-desc') list = list.slice().sort((a, b) => b.price - a.price);
    if (state.sort === 'rating') list = list.slice().sort((a, b) => b.rating - a.rating);
    return list;
  }

  function card(p) {
    const off = Math.round((1 - p.price / p.old) * 100);
    return `<article class="product">
      <div class="product-media" style="--c1:${p.c1};--c2:${p.c2}">
        <span class="p-icon" aria-hidden="true">${p.icon}</span>
        ${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}
        ${off > 0 ? `<span class="off">−${off}%</span>` : ''}
        <button class="media-hit" type="button" data-view="${p.id}" aria-label="View ${esc(p.name)}"></button>
      </div>
      <div class="product-body">
        <p class="p-cat">${esc(p.cat)}</p>
        <h3><button type="button" class="p-name" data-view="${p.id}">${esc(p.name)}</button></h3>
        <p class="rating"><span aria-hidden="true">★</span> ${p.rating} <small>(${p.reviews})</small></p>
        <div class="price"><b>${money(p.price)}</b><s>${money(p.old)}</s></div>
        <button class="btn btn-add" type="button" data-add="${p.id}">Add to cart</button>
      </div>
    </article>`;
  }

  function renderProducts() {
    const list = visibleProducts();
    $('#grid').innerHTML = list.map(card).join('');
    $('#empty').hidden = list.length !== 0;
    const label = list.length === PRODUCTS.length
      ? `${PRODUCTS.length} products`
      : `${list.length} of ${PRODUCTS.length} products`;
    $('#results').textContent = state.cat === 'All' ? label : `${label} · ${state.cat}`;
    $$('#chips .chip').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.cat === state.cat));
    });
  }

  /* ---------- Cart ---------- */

  function cartRow(item) {
    const p = productById(item.id);
    if (!p) return '';
    return `<div class="cart-item" data-id="${p.id}">
      <div class="ci-icon" style="--c1:${p.c1};--c2:${p.c2}" aria-hidden="true">${p.icon}</div>
      <div class="ci-info">
        <p class="ci-name">${esc(p.name)}</p>
        <p class="ci-price">${money(p.price)}</p>
        <div class="stepper" role="group" aria-label="Quantity for ${esc(p.name)}">
          <button type="button" data-qty="-1" data-id="${p.id}" aria-label="Decrease quantity">−</button>
          <span aria-live="polite">${item.qty}</span>
          <button type="button" data-qty="1" data-id="${p.id}" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <div class="ci-end">
        <b>${money(p.price * item.qty)}</b>
        <button type="button" class="link-btn" data-remove="${p.id}">Remove</button>
      </div>
    </div>`;
  }

  function renderCart() {
    const t = totals();
    const items = $('#cart-items');
    items.innerHTML = cart.map(cartRow).join('');
    $('#cart-empty').hidden = cart.length !== 0;
    $('#cart-summary').hidden = cart.length === 0;
    $('#free-ship').hidden = cart.length === 0;
    $('#cart-count').textContent = t.count;
    $('#cart-count').classList.toggle('bump', false);

    $('#sum-subtotal').textContent = money(t.subtotal);
    $('#sum-delivery').textContent = t.delivery === 0 ? 'Free' : money(t.delivery);
    $('#sum-total').textContent = money(t.total);

    const remaining = Math.max(0, FREE_SHIP - t.subtotal);
    $('#free-ship-text').innerHTML = cart.length === 0 ? '' : remaining > 0
      ? `Add <b>${money(remaining)}</b> more for free delivery`
      : '<b>Free delivery unlocked</b> 🎉';
    $('#ship-bar-fill').style.width = `${Math.min(100, (t.subtotal / FREE_SHIP) * 100)}%`;
    $('#to-checkout').disabled = cart.length === 0;
    saveCart();
  }

  function addToCart(id, qty = 1) {
    const p = productById(id);
    if (!p) return;
    const existing = cart.find((i) => i.id === id);
    if (existing) existing.qty = Math.min(10, existing.qty + qty);
    else cart.push({ id, qty: Math.min(10, qty) });
    renderCart();
    bumpCartCount();
    toast(`${p.name} added to cart`);
  }

  function changeQty(id, delta) {
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter((i) => i.id !== id);
    else item.qty = Math.min(10, item.qty);
    renderCart();
  }

  function removeItem(id) {
    const p = productById(id);
    cart = cart.filter((i) => i.id !== id);
    renderCart();
    if (p) toast(`${p.name} removed`);
  }

  function bumpCartCount() {
    const el = $('#cart-count');
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /* ---------- Drawer ---------- */

  function openCart() {
    lastFocus = document.activeElement;
    const drawer = $('#drawer');
    const scrim = $('#scrim');
    scrim.hidden = false;
    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      drawer.classList.add('open');
      scrim.classList.add('open');
    });
    document.body.classList.add('no-scroll');
    $('#cart-close').focus();
    showCartView();
  }

  function closeCart() {
    const drawer = $('#drawer');
    if (!drawer.classList.contains('open')) return;
    const scrim = $('#scrim');
    drawer.classList.remove('open');
    scrim.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    setTimeout(() => {
      if (drawer.classList.contains('open')) return;
      drawer.hidden = true;
      scrim.hidden = true;
    }, 260);
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function showCartView() {
    $('#cart-view').hidden = false;
    $('#checkout-view').hidden = true;
    $('#success-view').hidden = true;
    $('#drawer-title').textContent = 'Your cart';
    $('.drawer-body').scrollTop = 0;
  }

  function showCheckoutView() {
    if (cart.length === 0) return;
    $('#cart-view').hidden = true;
    $('#checkout-view').hidden = false;
    $('#success-view').hidden = true;
    $('#drawer-title').textContent = 'Checkout';
    $('.drawer-body').scrollTop = 0;
    $('#order-line').textContent = `${totals().count} item${totals().count === 1 ? '' : 's'} · ${money(totals().total)}`;
    setTimeout(() => $('#f-name').focus(), 60);
  }

  /* ---------- Toast ---------- */

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    $('#toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 240);
    }, 2400);
  }

  /* ---------- Product modal ---------- */

  function openProduct(id) {
    const p = productById(id);
    if (!p) return;
    modalQty = 1;
    const off = Math.round((1 - p.price / p.old) * 100);
    $('#modal-content').innerHTML = `
      <div class="modal-media" style="--c1:${p.c1};--c2:${p.c2}">
        <span aria-hidden="true">${p.icon}</span>
        ${off > 0 ? `<span class="off">−${off}%</span>` : ''}
      </div>
      <div class="modal-info">
        <p class="p-cat">${esc(p.cat)}${p.tag ? ` · ${esc(p.tag)}` : ''}</p>
        <h2 id="modal-title">${esc(p.name)}</h2>
        <p class="rating"><span aria-hidden="true">★</span> ${p.rating} <small>(${p.reviews} reviews)</small></p>
        <p class="modal-price"><b>${money(p.price)}</b> <s>${money(p.old)}</s></p>
        <p class="modal-desc">${esc(p.desc)}</p>
        <ul class="features">${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <div class="modal-buy">
          <div class="stepper" role="group" aria-label="Quantity">
            <button type="button" data-mqty="-1" aria-label="Decrease quantity">−</button>
            <span id="modal-qty">1</span>
            <button type="button" data-mqty="1" aria-label="Increase quantity">+</button>
          </div>
          <button class="btn btn-primary" type="button" id="modal-add" data-id="${p.id}">Add to cart</button>
        </div>
        <p class="modal-note">Cash on delivery · 7-day returns · Ships in 2–4 days</p>
      </div>`;
    const dlg = $('#product-modal');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    document.body.classList.add('no-scroll');
    setTimeout(() => $('#modal-close').focus(), 50);
  }

  function closeProduct() {
    const dlg = $('#product-modal');
    if (typeof dlg.close === 'function' && dlg.open) dlg.close();
    else dlg.removeAttribute('open');
    document.body.classList.remove('no-scroll');
  }
  /* ---------- Checkout ---------- */

  const FIELDS = [
    {
      id: 'f-name', err: 'err-name',
      test: (v) => v.trim().length >= 3,
      msg: 'Please enter your full name.'
    },
    {
      id: 'f-phone', err: 'err-phone',
      test: (v) => /^(92)?0?3\d{9}$/.test(v.replace(/\D/g, '')),
      msg: 'Enter a valid mobile number, e.g. 0300 1234567.'
    },
    {
      id: 'f-city', err: 'err-city',
      test: (v) => v !== '',
      msg: 'Choose your city.'
    },
    {
      id: 'f-address', err: 'err-address',
      test: (v) => v.trim().length >= 10,
      msg: 'Add a complete address: house, street, and area.'
    }
  ];

  function setError(field, show) {
    const input = $('#' + field.id);
    const msg = $('#' + field.err);
    input.classList.toggle('invalid', show);
    input.setAttribute('aria-invalid', String(show));
    msg.textContent = show ? field.msg : '';
  }

  function validate() {
    let firstBad = null;
    FIELDS.forEach((f) => {
      const input = $('#' + f.id);
      const ok = f.test(input.value);
      setError(f, !ok);
      if (!ok && !firstBad) firstBad = input;
    });
    if (firstBad) {
      firstBad.focus();
      toast('Please check the highlighted fields');
    }
    return !firstBad;
  }

  function placeOrder(ev) {
    ev.preventDefault();
    if (!validate()) return;
    if (cart.length === 0) { showCartView(); return; }

    const t = totals();
    const name = $('#f-name').value.trim();
    const phone = $('#f-phone').value.trim();
    const paymentInput = document.querySelector('input[name="payment"]:checked');

    const order = {
      id: 'DS-' + Date.now().toString(36).toUpperCase().slice(-6),
      name,
      phone,
      city: $('#f-city').value,
      address: $('#f-address').value.trim(),
      payment: paymentInput ? paymentInput.value : 'Cash on delivery',
      items: cart.map((i) => {
        const p = productById(i.id);
        return { id: p.id, name: p.name, price: p.price, qty: i.qty };
      }),
      subtotal: t.subtotal,
      delivery: t.delivery,
      total: t.total,
      placedAt: new Date().toISOString()
    };

    try {
      const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
      orders.push(order);
      localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
      localStorage.setItem('dastak-last-order', JSON.stringify(order));
    } catch (err) { /* storage may be unavailable */ }

    cart = [];
    saveCart();
    renderCart();

    $('#success-name').textContent = name.split(' ')[0];
    $('#success-phone').textContent = phone;
    $('#success-id').textContent = order.id;
    $('#success-total').textContent = money(order.total);
    $('#success-payment').textContent = order.payment;
    const eta = new Date(Date.now() + 3 * 86400000);
    $('#success-eta').textContent = eta.toLocaleDateString('en-PK', {
      weekday: 'short', day: 'numeric', month: 'short'
    });

    $('#cart-view').hidden = true;
    $('#checkout-view').hidden = true;
    $('#success-view').hidden = false;
    $('#drawer-title').textContent = 'Order confirmed';
    $('.drawer-body').scrollTop = 0;

    $('#f-name').value = '';
    $('#f-phone').value = '';
    $('#f-city').value = '';
    $('#f-address').value = '';
    FIELDS.forEach((f) => setError(f, false));
    toast('Order placed — we will call to confirm.');
  }

  /* ---------- Events ---------- */

  function bind() {
    document.addEventListener('click', (ev) => {
      const add = ev.target.closest('[data-add]');
      if (add) { addToCart(add.dataset.add); return; }

      const view = ev.target.closest('[data-view]');
      if (view) { openProduct(view.dataset.view); return; }

      const qty = ev.target.closest('[data-qty]');
      if (qty) { changeQty(qty.dataset.id, Number(qty.dataset.qty)); return; }

      const rem = ev.target.closest('[data-remove]');
      if (rem) { removeItem(rem.dataset.remove); return; }

      const catLink = ev.target.closest('[data-cat-link]');
      if (catLink) {
        ev.preventDefault();
        state.cat = catLink.dataset.catLink;
        renderProducts();
        $('#shop').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      const mqty = ev.target.closest('[data-mqty]');
      if (mqty) {
        modalQty = Math.max(1, Math.min(10, modalQty + Number(mqty.dataset.mqty)));
        $('#modal-qty').textContent = modalQty;
        return;
      }

      const modalAdd = ev.target.closest('#modal-add');
      if (modalAdd) {
        addToCart(modalAdd.dataset.id, modalQty);
        closeProduct();
      }
    });

    $('#chips').addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      state.cat = chip.dataset.cat;
      renderProducts();
    });

    $('#search').addEventListener('input', (ev) => {
      state.q = ev.target.value.trim();
      renderProducts();
    });

    $('#sort').addEventListener('change', (ev) => {
      state.sort = ev.target.value;
      renderProducts();
    });

    $('#cart-open').addEventListener('click', openCart);
    $('#cart-close').addEventListener('click', closeCart);
    $('#scrim').addEventListener('click', closeCart);
    $('#to-checkout').addEventListener('click', showCheckoutView);
    $('#back-to-cart').addEventListener('click', showCartView);
    $('#checkout-view').addEventListener('submit', placeOrder);

    $('#empty-shop').addEventListener('click', () => {
      closeCart();
      $('#shop').scrollIntoView({ behavior: 'smooth' });
    });
    $('#success-continue').addEventListener('click', () => {
      closeCart();
      $('#shop').scrollIntoView({ behavior: 'smooth' });
    });

    $('#modal-close').addEventListener('click', closeProduct);
    $('#product-modal').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) closeProduct();
    });
    $('#product-modal').addEventListener('close', () => {
      document.body.classList.remove('no-scroll');
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && $('#drawer').classList.contains('open')) closeCart();

      if (ev.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        ev.preventDefault();
        $('#search').focus();
      }

      if (ev.key === 'Tab' && $('#drawer').classList.contains('open')) {
        const focusables = $$('#drawer button, #drawer input, #drawer select, #drawer a')
          .filter((el) => !el.disabled && el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    });

    FIELDS.forEach((f) => {
      $('#' + f.id).addEventListener('input', () => setError(f, false));
    });
  }

  buildChips();
  renderProducts();
  renderCart();
  bind();
})();
