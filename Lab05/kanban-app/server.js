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

//baza
const db = new sqlite3.Database(path.join(__dirname, 'kanban.db'));

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS columns (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ord  INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      title   TEXT NOT NULL,
      col_id  INTEGER NOT NULL,
      ord     INTEGER NOT NULL,
      FOREIGN KEY(col_id) REFERENCES columns(id) ON DELETE CASCADE
    )
  `);

  //seed kolumn
  db.get('SELECT COUNT(*) AS cnt FROM columns', (err, row) => {
    if (row && row.cnt === 0) {
      db.run(
        `INSERT INTO columns (name, ord) VALUES 
          ('Todo',1),('Doing',2),('Done',3)`
      );
    }
  });

  //seed zadan
  db.get('SELECT COUNT(*) AS cnt FROM tasks', (err, row) => {
    if (row && row.cnt === 0) {
      db.run(
        `INSERT INTO tasks (title, col_id, ord) VALUES
          ('Zakupy na wyjazd w góry.', 1, 1),
          ('Napompować koła w rowerze.', 1, 2),
          ('Oddać sąsiadowi wkrętarkę, po 16:30.', 3, 1)`
      );
    }
  });
});

//GET /api/board
app.get('/api/board', (req, res) => {
  db.all(
    'SELECT id, name, ord FROM columns ORDER BY ord',
    (err, cols) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB error' });
      }
      db.all(
        'SELECT id, title, col_id, ord FROM tasks ORDER BY col_id, ord',
        (err2, tasks) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ error: 'DB error' });
          }
          res.json({ cols, tasks });
        }
      );
    }
  );
});

//POST /api/tasks
app.post('/api/tasks', (req, res) => {
  const { title, col_id } = req.body;

  if (!title || !col_id) {
    return res.status(400).json({ error: 'Missing title or col_id' });
  }

  const colIdNum = Number(col_id);
  if (!Number.isInteger(colIdNum) || colIdNum <= 0) {
    return res.status(422).json({ error: 'Invalid col_id' });
  }

  //czy kolumna istnieje
  db.get('SELECT id FROM columns WHERE id = ?', [colIdNum], (err, col) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }
    if (!col) {
      return res.status(404).json({ error: 'Column not found' });
    }

    //ustalenie ord = MAX+1 w danej kolumnie
    db.get(
      'SELECT IFNULL(MAX(ord), 0) AS maxOrd FROM tasks WHERE col_id = ?',
      [colIdNum],
      (err2, row) => {
        if (err2) {
          console.error(err2);
          return res.status(500).json({ error: 'DB error' });
        }
        const nextOrd = (row.maxOrd || 0) + 1;

        db.run(
          'INSERT INTO tasks (title, col_id, ord) VALUES (?, ?, ?)',
          [title, colIdNum, nextOrd],
          function (err3) {
            if (err3) {
              console.error(err3);
              return res.status(500).json({ error: 'DB error' });
            }
            res
              .status(201)
              .location(`/api/tasks/${this.lastID}`)
              .json({
                id: this.lastID,
                title,
                col_id: colIdNum,
                ord: nextOrd
              });
          }
        );
      }
    );
  });
});

//POST /api/tasks/:id/move
app.post('/api/tasks/:id/move', (req, res) => {
  const id = Number(req.params.id);
  const { col_id, ord } = req.body;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const targetColId = Number(col_id);
  let targetOrd = Number(ord);

  if (!Number.isInteger(targetColId) || !Number.isFinite(targetOrd)) {
    return res.status(400).json({ error: 'Invalid col_id or ord' });
  }

  if (targetOrd < 1) targetOrd = 1;

  //odczyt zadania
  db.get(
    'SELECT id, title, col_id, ord FROM tasks WHERE id = ?',
    [id],
    (err, task) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB error' });
      }
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const oldColId = task.col_id;
      const oldOrd = task.ord;

      //czy kolumna docelowa istnieje
      db.get(
        'SELECT id FROM columns WHERE id = ?',
        [targetColId],
        (err2, col) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ error: 'DB error' });
          }
          if (!col) {
            return res.status(404).json({ error: 'Target column not found' });
          }

          //ustalenie max ord w kolumnie docelowej zeby nie wyjsc poza zakres
          db.get(
            'SELECT IFNULL(MAX(ord), 0) AS maxOrd FROM tasks WHERE col_id = ?',
            [targetColId],
            (err3, row) => {
              if (err3) {
                console.error(err3);
                return res.status(500).json({ error: 'DB error' });
              }
              const maxOrd = row.maxOrd || 0;
              if (targetOrd > maxOrd + 1) {
                targetOrd = maxOrd + 1;
              }

              //jesli nic sie nie zmienia
              if (targetColId === oldColId && targetOrd === oldOrd) {
                return res.json({ success: true, unchanged: true });
              }

              db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                const handleError = (e) => {
                  if (e) {
                    console.error(e);
                    db.run('ROLLBACK', () => {
                      res.status(500).json({ error: 'DB error' });
                    });
                    return true;
                  }
                  return false;
                };

                if (targetColId === oldColId) {
                  //przeniesienie w obrebie tej samej kolumny
                  if (targetOrd > oldOrd) {
                    db.run(
                      `UPDATE tasks
                       SET ord = ord - 1
                       WHERE col_id = ? AND ord > ? AND ord <= ?`,
                      [oldColId, oldOrd, targetOrd],
                      (e1) => {
                        if (handleError(e1)) return;
                        db.run(
                          'UPDATE tasks SET ord = ? WHERE id = ?',
                          [targetOrd, id],
                          (e2) => {
                            if (handleError(e2)) return;
                            db.run('COMMIT', (e3) => {
                              if (handleError(e3)) return;
                              res.json({ success: true });
                            });
                          }
                        );
                      }
                    );
                  } else {
                    db.run(
                      `UPDATE tasks
                       SET ord = ord + 1
                       WHERE col_id = ? AND ord >= ? AND ord < ?`,
                      [oldColId, targetOrd, oldOrd],
                      (e1) => {
                        if (handleError(e1)) return;
                        db.run(
                          'UPDATE tasks SET ord = ? WHERE id = ?',
                          [targetOrd, id],
                          (e2) => {
                            if (handleError(e2)) return;
                            db.run('COMMIT', (e3) => {
                              if (handleError(e3)) return;
                              res.json({ success: true });
                            });
                          }
                        );
                      }
                    );
                  }
                } else {
                  //przeniesienie do innej kolumny
                  db.run(
                    'UPDATE tasks SET ord = ord - 1 WHERE col_id = ? AND ord > ?',
                    [oldColId, oldOrd],
                    (e1) => {
                      if (handleError(e1)) return;

                      db.run(
                        'UPDATE tasks SET ord = ord + 1 WHERE col_id = ? AND ord >= ?',
                        [targetColId, targetOrd],
                        (e2) => {
                          if (handleError(e2)) return;

                          db.run(
                            'UPDATE tasks SET col_id = ?, ord = ? WHERE id = ?',
                            [targetColId, targetOrd, id],
                            (e3) => {
                              if (handleError(e3)) return;
                              db.run('COMMIT', (e4) => {
                                if (handleError(e4)) return;
                                res.json({ success: true });
                              });
                            }
                          );
                        }
                      );
                    }
                  );
                }
              });
            }
          );
        }
      );
    }
  );
});

//UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Kanban server running at http://localhost:${PORT}`);
});