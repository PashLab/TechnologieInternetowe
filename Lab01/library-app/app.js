const express = require('express');
const path = require('path');
const db = require('./db'); //podpięcie sqlite

const app = express();
const PORT = 3000;

//middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//statyczne pliki z folderu public (html, js...)
app.use(express.static(path.join(__dirname, 'public')));

//healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

//GET /api/members
app.get('/api/members', (req, res) => {
  const sql = 'SELECT id, name, email FROM members ORDER BY id';
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('DB error', err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});

//helper dzisiejsza data YYYY-MM-DD
function today() {
  return new Date().toISOString().slice(0, 10);
}

//start srv
app.listen(PORT, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
});

//POST /api/members
app.post('/api/members', (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  const sql = 'INSERT INTO members(name, email) VALUES (?, ?)';

  db.run(sql, [name, email], function (err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        //unikalny @
        return res.status(409).json({ error: 'Email already exists' });
      }
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }

    res.status(201).json({
      id: this.lastID,
      name,
      email
    });
  });
});

//GET /api/books?author=&page=&pageSize=
app.get('/api/books', (req, res) => {
  const { author, page = 1, pageSize = 20 } = req.query;
  const p = parseInt(page, 10) || 1;
  const ps = parseInt(pageSize, 10) || 20;
  const offset = (p - 1) * ps;

  const params = [];
  let where = '';
  if (author) {
    where = 'WHERE b.author LIKE ?';
    params.push('%' + author + '%');
  }

  const sql = `
    SELECT 
      b.id,
      b.title,
      b.author,
      b.copies,
      b.copies - COALESCE(a.active, 0) AS available
    FROM books b
    LEFT JOIN (
      SELECT book_id, COUNT(*) AS active
      FROM loans
      WHERE return_date IS NULL
      GROUP BY book_id
    ) a ON a.book_id = b.id
    ${where}
    ORDER BY b.id
    LIMIT ? OFFSET ?
  `;
  params.push(ps, offset);

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});

//POST /api/books
app.post('/api/books', (req, res) => {
  let { title, author, copies } = req.body;

  if (!title || !author) {
    return res.status(400).json({ error: 'title and author are required' });
  }

  copies = parseInt(copies, 10);
  if (isNaN(copies) || copies <= 0) {
    copies = 1; // domyślnie 1
  }

  const sql = 'INSERT INTO books(title, author, copies) VALUES(?, ?, ?)';
  db.run(sql, [title, author, copies], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }

    res.status(201).json({
      id: this.lastID,
      title,
      author,
      copies
    });
  });
});

//GET /api/loans
app.get('/api/loans', (req, res) => {
  const sql = `
    SELECT 
      l.id,
      l.member_id,
      m.name AS member_name,
      m.email AS member_email,
      l.book_id,
      b.title AS book_title,
      b.author AS book_author,
      l.loan_date,
      l.due_date,
      l.return_date
    FROM loans l
    JOIN members m ON m.id = l.member_id
    JOIN books b   ON b.id = l.book_id
    ORDER BY l.id DESC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('DB error', err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});

//POST /api/loans/borrow
app.post('/api/loans/borrow', (req, res) => {
  const { member_id, book_id, days } = req.body;
  const memberId = parseInt(member_id, 10);
  const bookId = parseInt(book_id, 10);
  const loanDays = parseInt(days, 10) || 14;

  if (!memberId || !bookId) {
    return res.status(400).json({ error: 'member_id and book_id are required' });
  }

  db.serialize(() => {
    //1.spr czy klient exists
    db.get('SELECT id FROM members WHERE id = ?', [memberId], (err, memberRow) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB error' });
      }
      if (!memberRow) {
        return res.status(404).json({ error: 'Member not found' });
      }

      //2.spr czy ksiazka exists i popierz copies
      db.get('SELECT copies FROM books WHERE id = ?', [bookId], (err2, bookRow) => {
        if (err2) {
          console.error(err2);
          return res.status(500).json({ error: 'DB error' });
        }
        if (!bookRow) {
          return res.status(404).json({ error: 'Book not found' });
        }

        const copies = bookRow.copies;

        //3.zlicz aktywne wypo.
        db.get(
          'SELECT COUNT(*) AS active FROM loans WHERE book_id = ? AND return_date IS NULL',
          [bookId],
          (err3, loanRow) => {
            if (err3) {
              console.error(err3);
              return res.status(500).json({ error: 'DB error' });
            }

            const active = loanRow.active;
            if (active >= copies) {
              return res.status(409).json({ error: 'No copies available' });
            }

            //4.nowe wypo.
            const loanDate = today();
            const due = new Date();
            due.setDate(due.getDate() + loanDays);
            const dueDate = due.toISOString().slice(0, 10);

            const insertSql = `
              INSERT INTO loans(member_id, book_id, loan_date, due_date)
              VALUES (?, ?, ?, ?)
            `;
            db.run(insertSql, [memberId, bookId, loanDate, dueDate], function (err4) {
              if (err4) {
                console.error(err4);
                return res.status(500).json({ error: 'DB error' });
              }

              res.status(201).json({
                id: this.lastID,
                member_id: memberId,
                book_id: bookId,
                loan_date: loanDate,
                due_date: dueDate,
                return_date: null
              });
            });
          }
        );
      });
    });
  });
});

//POST /api/loans/return
app.post('/api/loans/return', (req, res) => {
  const { loan_id } = req.body;
  const loanId = parseInt(loan_id, 10);

  if (!loanId) {
    return res.status(400).json({ error: 'loan_id is required' });
  }

  //spr. czy loan istnieje +czy nie jest juz zwrocony
  db.get(
    'SELECT id, return_date FROM loans WHERE id = ?',
    [loanId],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB error' });
      }
      if (!row) {
        return res.status(404).json({ error: 'Loan not found' });
      }
      if (row.return_date) {
        return res.status(409).json({ error: 'Already returned' });
      }

      const returnDate = today();

      db.run(
        'UPDATE loans SET return_date = ? WHERE id = ?',
        [returnDate, loanId],
        function (err2) {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ error: 'DB error' });
          }

          return res.status(200).json({
            id: loanId,
            return_date: returnDate
          });
        }
      );
    }
  );
});

//BONUS GET /api/loans/overdue
app.get('/api/loans/overdue', (req, res) => {
  const todayStr = today();

  const sql = `
    SELECT
      l.id,
      m.name AS member_name,
      m.email AS member_email,
      b.title AS book_title,
      b.author AS book_author,
      l.loan_date,
      l.due_date
    FROM loans l
    JOIN members m ON m.id = l.member_id
    JOIN books b   ON b.id = l.book_id
    WHERE l.return_date IS NULL
      AND l.due_date < ?
    ORDER BY l.due_date ASC
  `;

  db.all(sql, [todayStr], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});