# JAK URUCHOMIĆ PROJEKTY

## 0. Wymagania programowe:

### Node.js 18+

    node -v
    npm -v

### Git

    git –version

### Thunder Client (dla VS Code do testów GET/ POST)

do pobrania w rozszerzeniach VS Code

## 1. Sklonuj repo do katalogu lokalnego na własnym komputerze

    git clone <repo_link>
    cd <localPC_path>

## 2. Przejdź do katalogu, w którym znajduje się plik package.json i wpisz w terminalu:

    npm install

(utworzy to katalog node_modules i pobierze m.in. express, sqlite3, cors, nodemon(dev) ).

## 3. Uruchom srv wpisując w terminal:

    npm run dev

## 4. Poprawnie uruchomiony srv da poniższy komunikat:

    Serwer działa na http://localhost:3000

Jeśli baza będzie wymagała resetu (np. po przeprowadzonych testach) wpisz:

    npm run reset:db ; npm run dev

(dla bash użyj „;”, dla PShell użyj „&&”)
