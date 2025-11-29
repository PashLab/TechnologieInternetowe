async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    //czytaj JSON, jak sie nie uda daj zwykly text
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.error || JSON.stringify(data);
    } catch (_) {
      message = await res.text();
    }
    throw new Error(`HTTP ${res.status}: ${message}`);
  }
  return res.json();
}

/*=================== witryna ksiazek ===================*/
async function loadBooks(author) {
  const tbody = document.querySelector('#booksTable tbody');
  if (!tbody) return; // nie ta strona

  const params = new URLSearchParams();
  if (author) params.set('author', author);

  const data = await fetchJSON('/api/books?' + params.toString());
  tbody.innerHTML = '';

  data.forEach(book => {
    const tr = document.createElement('tr');
    const isAvailable = book.available > 0;
    tr.innerHTML = `
      <td>${book.id}</td>
      <td>${book.title}</td>
      <td>${book.author}</td>
      <td>${book.copies}</td>
      <td>
        <span class="badge ${isAvailable ? 'badge-ok' : 'badge-no'}">
          ${book.available}
        </span>
      </td>
      <td>
        <button class="borrow-btn" data-book-id="${book.id}" ${isAvailable ? '' : 'disabled'}>
          Wypożycz
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  //podpinka przyciskow "Wypozycz"
  tbody.querySelectorAll('.borrow-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-book-id');
      const bookIdInput = document.getElementById('borrowBookId');
      if (bookIdInput) {
        bookIdInput.value = id;
        bookIdInput.focus();
      }
    });
  });
}

function setupBooksPage() {
  const booksTable = document.getElementById('booksTable');
  if (!booksTable) return; //nie na tej stronie

  const authorInput = document.getElementById('authorFilter');
  const filterBtn = document.getElementById('filterBtn');
  filterBtn.addEventListener('click', () => {
    loadBooks(authorInput.value);
  });

  //wstepne zaladowanie
  loadBooks();

  //formularz wypo.
  const borrowForm = document.getElementById('borrowForm');
  borrowForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(borrowForm);
    const body = {
      member_id: formData.get('member_id'),
      book_id: formData.get('book_id'),
      days: formData.get('days')
    };

    try {
      await fetchJSON('/api/loans/borrow', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      alert('Wypożyczono książkę!');
      borrowForm.reset();
      loadBooks(authorInput.value);
    } catch (err) {
    const msg = err.message || '';

    if (msg.includes('Member not found')) {
      alert('Brak Klienta o podanym ID!');
    } else if (msg.includes('Book not found')) {
      alert('Brak książki o podanym ID!');
    } else if (msg.includes('No copies available')) {
      alert('Brak dostępnych egzemplarzy tej książki!');
    } else {
      alert('Błąd przy wypożyczaniu: ' + msg);
    }
  }
  });

  //dormularz zqrotu
  const bookForm = document.getElementById('bookForm');
  bookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(bookForm);
    const body = {
      title: formData.get('title'),
      author: formData.get('author'),
      copies: formData.get('copies')
    };

    try {
      await fetchJSON('/api/books', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      alert('Dodano książkę!');
      bookForm.reset();
      loadBooks(authorInput.value);
    } catch (err) {
      alert('Błąd przy dodawaniu książki: ' + err.message);
    }
  });
}

/*=================== witryna members ===================*/
async function loadMembers() {
  const tbody = document.querySelector('#membersTable tbody');
  if (!tbody) return;

  const data = await fetchJSON('/api/members');
  tbody.innerHTML = '';

  data.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.id}</td>
      <td>${m.name}</td>
      <td>${m.email}</td>
    `;
    tbody.appendChild(tr);
  });
}

function setupMembersPage() {
  const membersTable = document.getElementById('membersTable');
  if (!membersTable) return;

  loadMembers();

  const form = document.getElementById('memberForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const body = {
      name: formData.get('name'),
      email: formData.get('email')
    };

    try {
      await fetchJSON('/api/members', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      alert('Dodano członka');
      form.reset();
      loadMembers();
    } catch (err) {
      alert('Błąd przy dodawaniu członka: ' + err.message);
    }
  });
}

/*=================== witryna wypozyczen ===================*/
async function loadLoans() {
  const tbody = document.querySelector('#loansTable tbody');
  if (!tbody) return;

  const data = await fetchJSON('/api/loans');
  tbody.innerHTML = '';

  data.forEach(l => {
    const active = !l.return_date;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${l.id}</td>
      <td>${l.member_name} (${l.member_email})</td>
      <td>${l.book_title} – ${l.book_author}</td>
      <td>${l.loan_date}</td>
      <td>${l.due_date}</td>
      <td>${l.return_date || ''}</td>
      <td>
        <span class="badge ${active ? 'badge-active' : 'badge-returned'}">
          ${active ? 'Aktywne' : 'Zwrócone'}
        </span>
      </td>
      <td>
        ${
          active
            ? `<button class="return-btn" data-loan-id="${l.id}">Zwróć</button>`
            : ''
        }
      </td>
    `;
    tbody.appendChild(tr);
  });

  //podpinaka przyciskow "Zwróć"
  tbody.querySelectorAll('.return-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const loanId = btn.getAttribute('data-loan-id');
      if (!confirm(`Na pewno zwrócić wypożyczenie #${loanId}?`)) return;

      try {
        await fetchJSON('/api/loans/return', {
          method: 'POST',
          body: JSON.stringify({ loan_id: loanId })
        });
        alert('Zwrócono książkę');
        loadLoans();
      } catch (err) {
        alert('Błąd przy zwrocie: ' + err.message);
      }
    });
  });
}

function setupLoansPage() {
  const loansTable = document.getElementById('loansTable');
  if (!loansTable) return;
  loadLoans();
}

/*=================== init ===================*/
document.addEventListener('DOMContentLoaded', () => {
  applySavedTheme();
  setupThemeToggle();
  setupBooksPage();
  setupMembersPage();
  setupLoansPage();
});

/*=================== motyw jasny/ciemny ===================*/
function applySavedTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') {
    document.body.classList.add('theme-dark');
  }
}

function setupThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;

  const updateLabel = () => {
    const isDark = document.body.classList.contains('theme-dark');
    btn.textContent = isDark ? 'Tryb jasny' : 'Tryb ciemny';
  };

  updateLabel();

  btn.addEventListener('click', () => {
    document.body.classList.toggle('theme-dark');
    localStorage.setItem(
      'theme',
      document.body.classList.contains('theme-dark') ? 'dark' : 'light'
    );
    updateLabel();
  });
}