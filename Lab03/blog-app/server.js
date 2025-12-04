const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

//===middleware===
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(path.join(__dirname, 'blog.db'));

//inicjalizacja schematu + seed
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      author     TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved   INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )
  `);

  //Seed o ile brak postow add 2 przykaldowe +kilka komm
  db.get('SELECT COUNT(*) AS count FROM posts', (err, row) => {
    if (err) {
      console.error('Błąd podczas liczenia postów:', err);
      return;
    }

    if (row.count === 0) {
      console.log('Seed bazy: dodawanie przykładowych postów i komentarzy...');

      db.run(
        'INSERT INTO posts (title, body) VALUES (?, ?)',
        ['Pierwszy post', 'Witaj w blogu demo. To jest pierwszy wpis.'],
        function (err) {
          if (err) {
            console.error('Błąd seeda post 1:', err);
            return;
          }
          const postId1 = this.lastID;

          db.run(
            'INSERT INTO comments (post_id, author, body, approved) VALUES (?, ?, ?, ?)',
            [postId1, 'Ala', 'Brawo! Świetny wpis.', 1]
          );
          db.run(
            'INSERT INTO comments (post_id, author, body, approved) VALUES (?, ?, ?, ?)',
            [postId1, 'Jan', 'Czekam na więcej treści.', 0]
          );
        }
      );

      db.run(
        'INSERT INTO posts (title, body) VALUES (?, ?)',
        ['Drugi post', 'To jest drugi przykładowy post na blogu.'],
        function (err) {
          if (err) {
            console.error('Błąd seeda post 2:', err);
            return;
          }
          const postId2 = this.lastID;

          db.run(
            'INSERT INTO comments (post_id, author, body, approved) VALUES (?, ?, ?, ?)',
            [postId2, 'Kasia', 'Super blog!', 0]
          );
        }
      );
    }
  });
});

//===ANTY-SPAM max 3 komentarze /5min /IP ===
const commentRateLimit = {}; //{ip:[timestamp1, timestamp2,...]}
const WINDOW_MS = 5 * 60 * 1000; //5min
const MAX_COMMENTS_IN_WINDOW = 3;

function checkRateLimit(ip) {
  const now = Date.now();
  if (!commentRateLimit[ip]) {
    commentRateLimit[ip] = [now];
    return true;
  }

  //czysci stare wpisy
  commentRateLimit[ip] = commentRateLimit[ip].filter(
    (ts) => now - ts <= WINDOW_MS
  );

  if (commentRateLimit[ip].length >= MAX_COMMENTS_IN_WINDOW) {
    return false;
  }

  commentRateLimit[ip].push(now);
  return true;
}

//===KONTRAKT API===

//GET /api/posts llista postow
app.get('/api/posts', (req, res) => {
  db.all(
    'SELECT id, title, body, created_at FROM posts ORDER BY created_at DESC',
    (err, rows) => {
      if (err) {
        console.error('Błąd pobierania postów:', err);
        return res.status(500).json({ error: 'Błąd serwera' });
      }
      res.json(rows);
    }
  );
});

//dodatkowy GET /api/posts/:id szczegoly posta
app.get('/api/posts/:id', (req, res) => {
  const id = req.params.id;
  db.get(
    'SELECT id, title, body, created_at FROM posts WHERE id = ?',
    [id],
    (err, row) => {
      if (err) {
        console.error('Błąd pobierania posta:', err);
        return res.status(500).json({ error: 'Błąd serwera' });
      }
      if (!row) {
        return res.status(404).json({ error: 'Post nie istnieje' });
      }
      res.json(row);
    }
  );
});

//POST /api/posts {title, body} add post
app.post('/api/posts', (req, res) => {
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'Brak pola title lub body' });
  }

  db.run(
    'INSERT INTO posts (title, body) VALUES (?, ?)',
    [title, body],
    function (err) {
      if (err) {
        console.error('Błąd dodawania posta:', err);
        return res.status(500).json({ error: 'Błąd serwera' });
      }
      res.status(201).json({
        id: this.lastID,
        title,
        body
      });
    }
  );
});

//GET /api/posts/:id/comments tylko approved=1 (+ paginacja bonus)
app.get('/api/posts/:id/comments', (req, res) => {
  const postId = req.params.id;
  const page = parseInt(req.query.page, 10) || 1;
  const pageSize = parseInt(req.query.pageSize, 10) || 10;
  const offset = (page - 1) * pageSize;

  db.all(
    `SELECT id, post_id, author, body, created_at, approved
     FROM comments
     WHERE post_id = ? AND approved = 1
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [postId, pageSize, offset],
    (err, rows) => {
      if (err) {
        console.error('Błąd pobierania komentarzy:', err);
        return res.status(500).json({ error: 'Błąd serwera' });
      }
      res.json({
        page,
        pageSize,
        comments: rows
      });
    }
  );
});

//POST /api/posts/:id/comments {author, body} ->201 {approved:0}
app.post('/api/posts/:id/comments', (req, res) => {
  const postId = req.params.id;
  const { author, body } = req.body;

  if (!author || !body) {
    return res.status(400).json({ error: 'Brak pola author lub body' });
  }

  //anty-spam
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res
      .status(429)
      .json({ error: 'Za dużo komentarzy, spróbuj ponownie za chwilę' });
  }

  db.get('SELECT id FROM posts WHERE id = ?', [postId], (err, row) => {
    if (err) {
      console.error('Błąd sprawdzania posta przed komentarzem:', err);
      return res.status(500).json({ error: 'Błąd serwera' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Post nie istnieje' });
    }

    db.run(
      'INSERT INTO comments (post_id, author, body, approved) VALUES (?, ?, ?, 0)',
      [postId, author, body],
      function (err) {
        if (err) {
          console.error('Błąd dodawania komentarza:', err);
          return res.status(500).json({ error: 'Błąd serwera' });
        }
        res.status(201).json({
          id: this.lastID,
          approved: 0
        });
      }
    );
  });
});

//POMOCNICZY endpoint dla panelu moderatora:
//GET /api/comments/pending komm oczekujace
app.get('/api/comments/pending', (req, res) => {
  db.all(
    `SELECT c.id, c.post_id, c.author, c.body, c.created_at, c.approved,
            p.title AS post_title
     FROM comments c
     JOIN posts p ON p.id = c.post_id
     WHERE c.approved = 0
     ORDER BY c.created_at ASC`,
    (err, rows) => {
      if (err) {
        console.error('Błąd pobierania oczekujących komentarzy:', err);
        return res.status(500).json({ error: 'Błąd serwera' });
      }
      res.json(rows);
    }
  );
});

//POST /api/comments/:id/approve ->200
app.post('/api/comments/:id/approve', (req, res) => {
  const commentId = req.params.id;

  db.run(
    'UPDATE comments SET approved = 1 WHERE id = ?',
    [commentId],
    function (err) {
      if (err) {
        console.error('Błąd zatwierdzania komentarza:', err);
        return res.status(500).json({ error: 'Błąd serwera' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Komentarz nie istnieje' });
      }
      res.json({ success: true });
    }
  );
});

//===ROUTY POD WIDOKI===

//lista postow index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//szczegoly posta +komm
app.get('/posts/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'post.html'));
});

//panel moderatora
app.get('/moderation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'moderation.html'));
});

//===start srv===
app.listen(PORT, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
});