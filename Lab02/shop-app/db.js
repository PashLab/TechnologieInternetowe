const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_FILE = path.join(__dirname, 'shop.db');

const db = new sqlite3.Database(DB_FILE);

function initDb() {
  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');

    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL,
        price REAL NOT NULL CHECK (price >= 0)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS order_items (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id   INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        qty        INTEGER NOT NULL CHECK (qty > 0),
        price      REAL NOT NULL,
        FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id)
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_order_items_order
      ON order_items(order_id)
    `);

    //seed produktow jak tabela jest pusta
    db.get('SELECT COUNT(*) AS count FROM products', (err, row) => {
      if (err) {
        console.error('Błąd przy liczeniu produktów:', err);
        return;
      }
      if (row.count === 0) {
        console.log('Seeduję przykładowe produkty...');
        const stmt = db.prepare(
          'INSERT INTO products(name, price) VALUES (?, ?)'
        );
        stmt.run('Klawiatura', 129.99);
        stmt.run('Mysz', 79.90);
        stmt.run('Monitor', 899.0);
        stmt.finalize();
      }
    });
  });
}

module.exports = {
  db,
  initDb
};