const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;
const { db, initDb } = require('./db');
//prosty koszyk w pamieci
//w ramach lab, restart srv resetuje koszyk
const cart = new Map();

app.use(cors());
app.use(express.json());

//logowanie żądan
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

//testowe API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Shop API działa' });
});

//GET /api/products
app.get('/api/products', (req, res) => {
  db.all('SELECT id, name, price FROM products ORDER BY id', (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});

//POST /api/products +prod w sklepie
app.post('/api/products', (req, res) => {
  const { name, price } = req.body;

  const parsedPrice = Number(price);

  if (!name || Number.isNaN(parsedPrice) || parsedPrice < 0) {
    return res
      .status(400)
      .json({ error: 'Invalid payload: name and price >= 0 are required' });
  }

  const sql = 'INSERT INTO products(name, price) VALUES (?, ?)';
  db.run(sql, [name, parsedPrice], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }

    res.status(201).json({
      id: this.lastID,
      name,
      price: parsedPrice
    });
  });
});

//GET /api/cart co w koszyku
app.get('/api/cart', (req, res) => {
  const itemsArray = Array.from(cart.entries()).map(([productId, qty]) => ({
    productId,
    qty
  }));

  if (itemsArray.length === 0) {
    return res.json({ items: [], total: 0 });
  }

  const ids = itemsArray.map(i => i.productId);
  const placeholders = ids.map(() => '?').join(',');

  db.all(
    `SELECT id, name, price FROM products WHERE id IN (${placeholders})`,
    ids,
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB error' });
      }

      const productMap = new Map(rows.map(r => [r.id, r]));

      let total = 0;
      const detailedItems = itemsArray.map(item => {
        const p = productMap.get(item.productId);
        if (!p) {
          //niby nie powinno się zdarzyć, bo walidujemy przy dodawaniu
          return null;
        }
        const lineTotal = p.price * item.qty;
        total += lineTotal;
        return {
          product_id: p.id,
          name: p.name,
          price: p.price,
          qty: item.qty,
          line_total: lineTotal
        };
      }).filter(Boolean);

      res.json({ items: detailedItems, total });
    }
  );
});

//POST /api/cart/add
app.post('/api/cart/add', (req, res) => {
  const { product_id, qty } = req.body;

  const productId = parseInt(product_id, 10);
  const quantity = parseInt(qty, 10);

  if (!productId || Number.isNaN(quantity) || quantity <= 0) {
    return res
      .status(400)
      .json({ error: 'Invalid payload: product_id and qty > 0 are required' });
  }

  //spr czy prod istnieje
  db.get('SELECT id FROM products WHERE id = ?', [productId], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const currentQty = cart.get(productId) || 0;
    const newQty = currentQty + quantity;
    cart.set(productId, newQty);

    res.status(201).json({
      product_id: productId,
      qty: newQty
    });
  });
});

//PATCH /api/cart/item zmiana ilosci w koszyky
app.patch('/api/cart/item', (req, res) => {
  const { product_id, qty } = req.body;

  const productId = parseInt(product_id, 10);
  const quantity = parseInt(qty, 10);

  if (!productId || Number.isNaN(quantity) || quantity <= 0) {
    return res
      .status(400)
      .json({ error: 'Invalid payload: product_id and qty > 0 are required' });
  }

  //spr czy prod istnieje
  db.get('SELECT id FROM products WHERE id = ?', [productId], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (!cart.has(productId)) {
      return res.status(404).json({ error: 'Product not in cart' });
    }

    cart.set(productId, quantity);

    res.json({
      product_id: productId,
      qty: quantity
    });
  });
});

//DELETE /api/cart/item/:product_id
app.delete('/api/cart/item/:product_id', (req, res) => {
  const productId = parseInt(req.params.product_id, 10);

  if (!productId) {
    return res.status(400).json({ error: 'Invalid product_id' });
  }

  if (!cart.has(productId)) {
    return res.status(404).json({ error: 'Product not in cart' });
  }

  cart.delete(productId);

  res.status(204).send();
});

//POST /api/checkout finalizacja
app.post('/api/checkout', (req, res) => {
  const itemsArray = Array.from(cart.entries()).map(([productId, qty]) => ({
    productId,
    qty
  }));

  if (itemsArray.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  const ids = itemsArray.map(i => i.productId);
  const placeholders = ids.map(() => '?').join(',');

  //pobieranie produktow i cen(snapshot)
  db.all(
    `SELECT id, name, price FROM products WHERE id IN (${placeholders})`,
    ids,
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB error' });
      }

      if (rows.length !== ids.length) {
        //nonie powinno sie wydarzyc ale na wszelki
        return res.status(400).json({ error: 'Some products not found' });
      }

      const productMap = new Map(rows.map(r => [r.id, r]));

      //przygotowanie pozycji z cena snapshot +suma
      let total = 0;
      const orderItems = itemsArray.map(item => {
        const p = productMap.get(item.productId);
        const lineTotal = p.price * item.qty;
        total += lineTotal;
        return {
          product_id: p.id,
          qty: item.qty,
          price: p.price //snap ceny
        };
      });

      //transakcja orders + order_items
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run('INSERT INTO orders DEFAULT VALUES', function (err2) {
          if (err2) {
            console.error(err2);
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'DB error' });
          }

          const orderId = this.lastID;
          let remaining = orderItems.length;
          let hadError = false;

          const stmt = db.prepare(
            'INSERT INTO order_items(order_id, product_id, qty, price) VALUES (?, ?, ?, ?)'
          );

          orderItems.forEach(item => {
            stmt.run(
              [orderId, item.product_id, item.qty, item.price],
              err3 => {
                if (err3) {
                  console.error(err3);
                  hadError = true;
                  //rollback 1x ale nie konczymy petli sila boi tak zaraz wyjdziemy
                  db.run('ROLLBACK');
                  return res
                    .status(500)
                    .json({ error: 'DB error inserting order_items' });
                }

                remaining -= 1;
                if (remaining === 0 && !hadError) {
                  stmt.finalize(err4 => {
                    if (err4) {
                      console.error(err4);
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: 'DB error' });
                    }

                    db.run('COMMIT', err5 => {
                      if (err5) {
                        console.error(err5);
                        return res.status(500).json({ error: 'DB error' });
                      }

                      //sukces no to czyscimy koszyk
                      cart.clear();

                      return res.status(201).json({
                        order_id: orderId,
                        total
                      });
                    });
                  });
                }
              }
            );
          });
        });
      });
    }
  );
});

//statyczne pliki frontu (public/)
app.use(express.static(path.join(__dirname, 'public')));

initDb();

app.listen(PORT, () => {
  console.log(`Shop server działa na http://localhost:${PORT}`);
});

app.listen(PORT, () => {
  console.log(`Shop server działa na http://localhost:${PORT}`);
});