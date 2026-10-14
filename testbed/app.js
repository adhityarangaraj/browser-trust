const form = document.querySelector('#demo-form');
const result = document.querySelector('#result');
const allButtons = [...document.querySelectorAll('button')];
const syntheticPayload = () => ({
  displayName: 'BrowserTrust Demo',
  note: 'Synthetic test submission'
});

function setStatus(message, isError = false) {
  result.textContent = message;
  result.classList.toggle('error', isError);
}

async function postToLocalCollector(url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(syntheticPayload()),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Collector returned HTTP ${response.status}`);
  return response.json();
}

async function submitForm() {
  setStatus('Submitting the synthetic form…');
  try {
    // Keep a real, trusted submit event from a user click for BrowserTrust's rule.
    form.requestSubmit();
    // The submit handler prevents navigation and performs the local POST.
  } catch (error) {
    setStatus(error.message || 'Form submission failed.', true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await postToLocalCollector('/collect');
    form.dispatchEvent(new CustomEvent('bt-form-complete'));
    setStatus('Form submitted. Refresh BrowserTrust to inspect the observed events.');
  } catch (error) {
    setStatus(`${error.message || 'Form request failed.'} Is npm run testbed running?`, true);
  }
});

document.querySelector('#submit-button').addEventListener('click', submitForm);

document.querySelector('#storage-button').addEventListener('click', () => {
  localStorage.setItem('browsertrust-testbed', 'synthetic-only');
  setStatus('Synthetic local-storage marker written. Refresh BrowserTrust to inspect the event.');
});

async function sendRepeatedPosts() {
  setStatus('Sending three POST requests to localhost…');
  for (let index = 0; index < 3; index++) {
    await postToLocalCollector('http://localhost:4173/collect');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  setStatus('Three POST requests completed. Refresh BrowserTrust to inspect network observations.');
}

document.querySelector('#network-button').addEventListener('click', async () => {
  try {
    await sendRepeatedPosts();
  } catch (error) {
    setStatus(`${error.message || 'Network simulation failed.'} Confirm the testbed server is running.`, true);
  }
});

document.querySelector('#run-all').addEventListener('click', async () => {
  allButtons.forEach(button => button.disabled = true);
  try {
    setStatus('Action 1/3: submitting the synthetic form…');
    // Invoke the real submit button so Chrome emits a trusted submit event.
    await new Promise((resolve, reject) => {
      const once = () => { cleanup(); resolve(); };
      const cleanup = () => form.removeEventListener('bt-form-complete', once);
      form.addEventListener('bt-form-complete', once, { once: true });
      document.querySelector('#submit-button').click();
      setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for form submission')); }, 5000);
    });
    setStatus('Action 2/3: writing a local-storage marker…');
    localStorage.setItem('browsertrust-testbed', 'synthetic-only');
    setStatus('Action 3/3: sending repeated POST requests…');
    await sendRepeatedPosts();
    setStatus('All actions completed. Refresh BrowserTrust to inspect events and findings.');
  } catch (error) {
    setStatus(`${error.message || 'Simulation failed.'} Confirm the testbed server is running.`, true);
  } finally {
    allButtons.forEach(button => button.disabled = false);
  }
});
