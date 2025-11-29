async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data.error || JSON.stringify(data);
    } catch (_) {
      msg = await res.text();
    }
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  if (res.status === 204) {
    return null;
  }

  return res.json();
}

/*=================== produkty ===================*/
async function loadProducts() {
  const tbody = document.querySelector('#productsTable tbody');
  if (!tbody) return;

  try {
    const products = await fetchJSON('/api/products');
    tbody.innerHTML = '';

    products.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.id}</td>
        <td>${p.name}</td>
        <td>${p.price.toFixed ? p.price.toFixed(2) : p.price}</td>
        <td>
          <button class="btn-add" data-product-id="${p.id}">
            Dodaj do koszyka
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-add').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-product-id');
        try {
          // domyslnie + 1szt
          await fetchJSON('/api/cart/add', {
            method: 'POST',
            body: JSON.stringify({ product_id: Number(id), qty: 1 })
          });
          await loadCart();
        } catch (err) {
          alert('Błąd przy dodawaniu do koszyka: ' + err.message);
        }
      });
    });
  } catch (err) {
    alert('Błąd przy ładowaniu produktów: ' + err.message);
  }
}

/*=================== koszyk ===================*/
async function loadCart() {
  const tbody = document.querySelector('#cartTable tbody');
  const emptyInfo = document.getElementById('cartEmpty');
  const totalDiv = document.getElementById('cartTotal');
  if (!tbody) return;

  try {
    const data = await fetchJSON('/api/cart');
    tbody.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      emptyInfo.style.display = 'block';
      totalDiv.textContent = '';
      return;
    }

    emptyInfo.style.display = 'none';

    data.items.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.name}</td>
        <td>${item.price.toFixed ? item.price.toFixed(2) : item.price}</td>
        <td>
          <input type="number" min="1" value="${item.qty}" data-product-id="${item.product_id}" />
        </td>
        <td>${item.line_total.toFixed ? item.line_total.toFixed(2) : item.line_total}</td>
        <td>
          <button class="btn-update" data-product-id="${item.product_id}">Zapisz</button>
          <button class="btn-remove" data-product-id="${item.product_id}">Usuń</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    totalDiv.textContent = 'Suma: ' + (data.total.toFixed ? data.total.toFixed(2) : data.total) + ' zł';

    //przyciski "Zapisz"/PATCH i "Usuń"/DELETE
    tbody.querySelectorAll('.btn-update').forEach(btn => {
      btn.addEventListener('click', async () => {
        const productId = Number(btn.getAttribute('data-product-id'));
        const input = tbody.querySelector(`input[data-product-id="${productId}"]`);
        const qty = Number(input.value);

        if (!qty || qty <= 0) {
          alert('Ilość musi być > 0');
          return;
        }

        try {
          await fetchJSON('/api/cart/item', {
            method: 'PATCH',
            body: JSON.stringify({ product_id: productId, qty })
          });
          await loadCart();
        } catch (err) {
          alert('Błąd przy zmianie ilości: ' + err.message);
        }
      });
    });

    tbody.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const productId = btn.getAttribute('data-product-id');
        if (!confirm('Usunąć ten produkt z koszyka?')) return;

        try {
          await fetchJSON(`/api/cart/item/${productId}`, {
            method: 'DELETE'
          });
          await loadCart();
        } catch (err) {
          alert('Błąd przy usuwaniu pozycji: ' + err.message);
        }
      });
    });
  } catch (err) {
    alert('Błąd przy ładowaniu koszyka: ' + err.message);
  }
}

/* =================== checkout =================== */
function setupCheckout() {
  const btn = document.getElementById('checkoutBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (!confirm('Na pewno zrealizować zamówienie?')) return;

    try {
      const result = await fetchJSON('/api/checkout', {
        method: 'POST'
      });
      alert(`Zamówienie utworzone. ID: ${result.order_id}, suma: ${result.total.toFixed ? result.total.toFixed(2) : result.total} zł`);
      await loadCart();
    } catch (err) {
      if (err.message.includes('Cart is empty')) {
        alert('Koszyk jest pusty – nie można złożyć zamówienia.');
      } else {
        alert('Błąd przy składaniu zamówienia: ' + err.message);
      }
    }
  });
}

/* =================== init =================== */
document.addEventListener('DOMContentLoaded', () => {
  loadProducts();
  loadCart();
  setupCheckout();
});