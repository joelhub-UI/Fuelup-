const form = document.getElementById('login-form');
const error = document.getElementById('error');

// Schon angemeldet (oder kein Passwortschutz aktiv)? Dann direkt zur App.
fetch('/api/session').then((r) => r.json()).then((s) => {
  if (s.authenticated) location.replace('/');
}).catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.submitter || form.querySelector('button');
  button.disabled = true;
  error.hidden = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    if (res.ok) return location.replace('/');
    const body = await res.json().catch(() => ({}));
    error.textContent = body.error || `Fehler ${res.status}`;
  } catch {
    error.textContent = 'Der FuelUp-Server ist nicht erreichbar.';
  }
  error.hidden = false;
  button.disabled = false;
});
