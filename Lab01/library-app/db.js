const sqlite3 = require('sqlite3').verbose();
const path = require('path');

//plik DB powstanie w folderze projektu
const DB_FILE = path.join(__dirname, 'library.db');

const db = new sqlite3.Database(DB_FILE);

function runMigrationsAndSeed() {
  db.serialize(() => {
    //tab members
    db.run(`
      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE
      )
    `);

    //tab books
    db.run(`
      CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        copies INTEGER NOT NULL CHECK (copies >= 0)
      )
    `);

    //tab loans
    db.run(`
      CREATE TABLE IF NOT EXISTS loans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        loan_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        return_date TEXT NULL,
        FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      )
    `);

    //seed members (tylko jak pusto)
    db.get('SELECT COUNT(*) AS cnt FROM members', (err, row) => {
      if (err) {
        console.error('Error checking members count', err);
        return;
      }
      if (row.cnt === 0) {
        console.log('Seeding members...');
        db.run(
          `INSERT INTO members(name, email) VALUES
          ('Ala Kowalska', 'ala@example.com'),
          ('Jan Nowak', 'jan@example.com')`
        );
      }
    });

    //seed books (tylko jak pusto)
    db.get('SELECT COUNT(*) AS cnt FROM books', (err, row) => {
      if (err) {
        console.error('Error checking books count', err);
        return;
      }
      if (row.cnt === 0) {
        console.log('Seeding books...');
        db.run(
          `INSERT INTO books(title, author, copies) VALUES
          ('Clean Code', 'R. Martin', 3),
          ('Domain-Driven Design', 'E. Evans', 2),
          ('You Don''t Know JS', 'K. Simpson', 4)`
        );
      }
    });
  });
}

runMigrationsAndSeed();

module.exports = db;
