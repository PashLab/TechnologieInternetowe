const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

//movies.db
const db = new sqlite3.Database(path.join(__dirname, 'movies.db'));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      year INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL,
      score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
      FOREIGN KEY(movie_id) REFERENCES movies(id) ON DELETE CASCADE
    )
  `);

  //seed jesli brak danych
  db.get('SELECT COUNT(*) AS cnt FROM movies', (err, row) => {
    if (row && row.cnt === 0) {
      console.log("Seeding movies + ratings...");

      db.run(`INSERT INTO movies (title, year) VALUES 
        ('Inception', 2010),
        ('Matrix', 1999),
        ('Arrival', 2016)
      `);

      db.run(`INSERT INTO ratings (movie_id, score) VALUES
        (1, 5), (1, 4),
        (2, 5),
        (3, 4), (3, 5)
      `);
    }
  });
});

//wspolna cz. zapytania rankingowego
const rankingQueryBase = `
  SELECT 
    m.id,
    m.title,
    m.year,
    ROUND(AVG(r.score), 2) AS avg_score,
    COUNT(r.id) AS votes
  FROM movies m
  LEFT JOIN ratings r ON r.movie_id = m.id
`;

//GET /api/movies
//ranking z opcjonalnymi parametrami: ?year=YYYY&limit=N
app.get('/api/movies', (req, res) => {
  const { year, limit } = req.query;

  const params = [];
  let where = "";
  let limitClause = "";

  if (year) {
    where = "WHERE m.year = ?";
    params.push(year);
  }

  if (limit) {
    limitClause = "LIMIT ?";
    params.push(limit);
  }

  const sql = `
    ${rankingQueryBase}
    ${where}
    GROUP BY m.id
    ORDER BY avg_score DESC, votes DESC
    ${limitClause}
  `;

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});

//GET /api/movies/top?limit=5(&year=YYYY) bonus
app.get('/api/movies/top', (req, res) => {
  const { year, limit } = req.query;

  const params = [];
  let where = "";
  let limitClause = "";

  if (year) {
    where = "WHERE m.year = ?";
    params.push(year);
  }

  const topLimit = limit || 5; //domyslnie 5
  limitClause = "LIMIT ?";
  params.push(topLimit);

  const sql = `
    ${rankingQueryBase}
    ${where}
    GROUP BY m.id
    ORDER BY avg_score DESC, votes DESC
    ${limitClause}
  `;

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});

//POST /api/movies
app.post('/api/movies', (req, res) => {
  const { title, year } = req.body;

  if (!title || !year) {
    return res.status(400).json({ error: "Missing title or year" });
  }

  db.run(
    `INSERT INTO movies (title, year) VALUES (?, ?)`,
    [title, year],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB error' });
      }
      res.status(201).json({ id: this.lastID, title, year });
    }
  );
});

//POST /api/ratings
app.post('/api/ratings', (req, res) => {
  const { movie_id, score } = req.body;

  if (!movie_id || score == null) {
    return res.status(400).json({ error: "Missing movie_id or score" });
  }

  if (score < 1 || score > 5) {
    return res.status(400).json({ error: "Score must be between 1 and 5" });
  }

  db.get(`SELECT id FROM movies WHERE id = ?`, [movie_id], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB error' });
    }

    if (!row) {
      return res.status(404).json({ error: "Movie not found" });
    }

    db.run(
      `INSERT INTO ratings (movie_id, score) VALUES (?, ?)`,
      [movie_id, score],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'DB error' });
        }
        res.status(201).json({ id: this.lastID });
      }
    );
  });
});

//UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});