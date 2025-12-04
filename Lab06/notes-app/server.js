const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

//middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

//sec +logging
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

//db
const db = new sqlite3.Database(path.join(__dirname, 'notes.db'));

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS note_tags (
      note_id INTEGER NOT NULL,
      tag_id  INTEGER NOT NULL,
      PRIMARY KEY (note_id, tag_id),
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
    )
  `);

  //seed notatek
  db.get('SELECT COUNT(*) AS cnt FROM notes', (err, row) => {
    if (err) {
      console.error('Seed notes error', err);
      return;
    }
    if (row && row.cnt === 0) {
      db.run(
        `INSERT INTO notes (title, body) VALUES
          ('Pierwsza notatka', 'To jest przykładowa notatka o planach na tydzień.'),
          ('Pomysły na prezenty', 'Zebrać pomysły na prezenty urodzinowe dla rodziny.'),
          ('Praca – spotkanie', 'Przygotować agendę na jutrzejsze spotkanie projektowe.')`
      );
    }
  });

  //seed tagow +powiazan
  db.get('SELECT COUNT(*) AS cnt FROM tags', (err, row) => {
    if (err) {
      console.error('Seed tags error', err);
      return;
    }
    if (row && row.cnt === 0) {
      db.run(
        `INSERT INTO tags (name) VALUES ('work'), ('home'), ('ideas')`,
        (e) => {
          if (e) {
            console.error('Insert tags error', e);
            return;
          }
          //powiazania przy zalozeniu ze notatki maja id 1..3
          db.run(
            `INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES
              (1, 3),  -- pierwsza notatka -> ideas
              (2, 2),  -- prezenty -> home
              (3, 1)   -- spotkanie -> work
            `
          );
        }
      );
    }
  });
});

//pomocnicze pobranie tagow dla wielu notatek
function attachTagsToNotes(notes, callback) {
  if (notes.length === 0) return callback([]);

  const ids = notes.map(n => n.id);
  const placeholders = ids.map(() => '?').join(',');

  db.all(
    `
    SELECT nt.note_id, t.name
    FROM note_tags nt
    JOIN tags t ON t.id = nt.tag_id
    WHERE nt.note_id IN (${placeholders})
    ORDER BY t.name
    `,
    ids,
    (err, rows) => {
      if (err) {
        return callback(err);
      }
      const map = new Map();
      for (const n of notes) {
        map.set(n.id, []);
      }
      for (const r of rows) {
        map.get(r.note_id).push(r.name);
      }
      const result = notes.map(n => ({
        ...n,
        tags: map.get(n.id) || []
      }));
      callback(null, result);
    }
  );
}

//GET /api/notes?q=&tag=
app.get('/api/notes', (req, res) => {
  const { q, tag } = req.query;

  let sql = `
    SELECT DISTINCT n.id, n.title, n.body, n.created_at
    FROM notes n
    LEFT JOIN note_tags nt ON nt.note_id = n.id
    LEFT JOIN tags t ON t.id = nt.tag_id
    WHERE 1=1
  `;
  const params = [];

  if (q && q.trim() !== '') {
    sql += ` AND (n.title LIKE ? OR n.body LIKE ?)`;
    const like = `%${q.trim()}%`;
    params.push(like, like);
  }

  if (tag && tag.trim() !== '') {
    sql += ` AND t.name = ?`;
    params.push(tag.trim());
  }

  sql += ` ORDER BY n.created_at DESC, n.id DESC`;

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }

    attachTagsToNotes(rows, (err2, withTags) => {
      if (err2) {
        console.error(err2);
        return res.status(500).json({ error: 'DB error' });
      }
      res.json(withTags);
    });
  });
});

//POST /api/notes
app.post('/api/notes', (req, res) => {
  const { title, body } = req.body;

  if (!title || !body || !title.trim() || !body.trim()) {
    return res.status(400).json({ error: 'Missing title or body' });
  }

  db.run(
    'INSERT INTO notes (title, body) VALUES (?, ?)',
    [title.trim(), body.trim()],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB error' });
      }
      const newId = this.lastID;
      db.get(
        'SELECT id, title, body, created_at FROM notes WHERE id = ?',
        [newId],
        (err2, row) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ error: 'DB error' });
          }
          res
            .status(201)
            .location(`/api/notes/${newId}`)
            .json({ ...row, tags: [] });
        }
      );
    }
  );
});

//GET /api/tags
app.get('/api/tags', (req, res) => {
  db.all('SELECT id, name FROM tags ORDER BY name', (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});

//POST /api/notes/:id/tags
app.post('/api/notes/:id/tags', (req, res) => {
  const noteId = Number(req.params.id);
  const { tags } = req.body;

  if (!Number.isInteger(noteId) || noteId <= 0) {
    return res.status(400).json({ error: 'Invalid note id' });
  }

  if (!Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Tags array required' });
  }

  //normalizacja tagow
  const cleaned = [...new Set(
    tags
      .map(t => (t || '').trim().toLowerCase())
      .filter(t => t.length > 0)
  )];

  if (cleaned.length === 0) {
    return res.status(400).json({ error: 'No valid tags' });
  }

  //czy notatka istnieje
  db.get('SELECT id FROM notes WHERE id = ?', [noteId], (err, note) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      const handleErr = (e) => {
        if (e) {
          console.error(e);
          db.run('ROLLBACK', () => {
            res.status(500).json({ error: 'DB error' });
          });
          return true;
        }
        return false;
      };

      //1.utworz brakujace tagi
      const insertTags = (cb) => {
        if (cleaned.length === 0) return cb();
        let remaining = cleaned.length;
        cleaned.forEach(name => {
          db.run(
            'INSERT OR IGNORE INTO tags (name) VALUES (?)',
            [name],
            (e) => {
              if (handleErr(e)) return;
              if (--remaining === 0) cb();
            }
          );
        });
      };

      const linkTags = () => {
        //2.pobierz ich id
        const placeholders = cleaned.map(() => '?').join(',');
        db.all(
          `SELECT id, name FROM tags WHERE name IN (${placeholders})`,
          cleaned,
          (e, rows) => {
            if (handleErr(e)) return;

            if (!rows || rows.length === 0) {
              return handleErr(new Error('No tags found after insert'));
            }

            let left = rows.length;
            rows.forEach(r => {
              db.run(
                'INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)',
                [noteId, r.id],
                (e2) => {
                  if (handleErr(e2)) return;
                  if (--left === 0) {
                    db.run('COMMIT', (e3) => {
                      if (handleErr(e3)) return;
                      //zwrot aktualnej listy tagow tej notatki
                      db.all(
                        `SELECT t.name 
                         FROM note_tags nt
                         JOIN tags t ON t.id = nt.tag_id
                         WHERE nt.note_id = ?
                         ORDER BY t.name`,
                        [noteId],
                        (e4, tagRows) => {
                          if (e4) {
                            console.error(e4);
                            return res.status(500).json({ error: 'DB error' });
                          }
                          res.json({
                            note_id: noteId,
                            tags: tagRows.map(r => r.name)
                          });
                        }
                      );
                    });
                  }
                }
              );
            });
          }
        );
      };

      insertTags(linkTags);
    });
  });
});

//UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Notes server running at http://localhost:${PORT}`);
});